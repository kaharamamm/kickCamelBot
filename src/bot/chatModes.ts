import { getMyChannelCached, sendChatCommand } from "../kick/api.js";
import { detectLaughBurst } from "./chatLog.js";
import { say } from "./outbox.js";
import type { IncomingChat } from "../types.js";

const AUTO_COOLDOWN_MS = 40 * 60_000;
const CLIP_COOLDOWN_MS = 25 * 60_000;
const EMOTE_AUTO_CHANCE = 1 / 100_000;

let lastAuto = 0;
let lastClip = 0;
let pulseOff: ReturnType<typeof setTimeout> | undefined;

export async function streamIsLive(): Promise<boolean> {
  try {
    return Boolean((await getMyChannelCached()).stream?.is_live);
  } catch {
    return false;
  }
}

export async function sendModSlash(command: string): Promise<boolean> {
  return sendChatCommand(command.trim());
}

export async function setEmoteOnly(on: boolean): Promise<boolean> {
  if (!(await streamIsLive())) {
    console.log("[emoteonly] skip, stream offline");
    return false;
  }
  return sendModSlash(on ? "/emoteonly on" : "/emoteonly off");
}

export async function setSlowMode(on: boolean, gapSec = 10): Promise<boolean> {
  if (!on) return sendModSlash("/slow off");
  const gap = Math.min(120, Math.max(3, Math.round(gapSec)));
  return sendModSlash(`/slow on ${gap}`);
}

export async function setFollowOnly(on: boolean): Promise<boolean> {
  return sendModSlash(on ? "/followonly on" : "/followonly off");
}

export async function setSubOnly(on: boolean): Promise<boolean> {
  return sendModSlash(on ? "/subonly on" : "/subonly off");
}

export async function clearChat(): Promise<boolean> {
  return sendModSlash("/clear");
}

export async function createClip(opts?: { seconds?: number; title?: string }): Promise<boolean> {
  const seconds = Math.min(180, Math.max(10, Math.round(opts?.seconds ?? 30)));
  const title = (opts?.title ?? "").replace(/[^\p{L}\p{N} _-]/gu, "").trim().slice(0, 48);
  const cmd = title ? `/clip ${seconds} ${title}` : `/clip ${seconds}`;
  return sendModSlash(cmd);
}

export async function pulseEmoteMode(
  broadcasterUserId: number,
  opts?: { seconds?: number; announce?: boolean; force?: boolean },
): Promise<boolean> {
  return pulseMode(broadcasterUserId, "emote", opts);
}

export async function pulseSlowMode(
  broadcasterUserId: number,
  opts?: { seconds?: number; announce?: boolean; force?: boolean; gapSec?: number },
): Promise<boolean> {
  return pulseMode(broadcasterUserId, "slow", { ...opts, gapSec: opts?.gapSec ?? 8 });
}

async function pulseMode(
  broadcasterUserId: number,
  kind: "emote" | "slow",
  opts?: { seconds?: number; announce?: boolean; force?: boolean; gapSec?: number },
): Promise<boolean> {
  const now = Date.now();
  if (!opts?.force && now - lastAuto < AUTO_COOLDOWN_MS) return false;
  if (kind === "emote" && !(await streamIsLive())) return false;
  const hold = Math.min(60, Math.max(8, Math.round(opts?.seconds ?? 8 + Math.random() * 25)));
  const ok = kind === "emote" ? await setEmoteOnly(true) : await setSlowMode(true, opts?.gapSec ?? 8);
  if (!ok) return false;
  lastAuto = now;
  if (pulseOff) clearTimeout(pulseOff);
  pulseOff = setTimeout(() => {
    void (async () => {
      if (kind === "emote") {
        if (!(await streamIsLive())) return;
        await setEmoteOnly(false);
      } else {
        await setSlowMode(false);
      }
      if (opts?.announce !== false) {
        await say(kind === "emote" ? "Emote-only off. You may speak again." : "Slow mode off.", undefined, broadcasterUserId);
      }
    })();
  }, hold * 1000);
  if (opts?.announce !== false) {
    await say(
      kind === "emote" ? `Emote-only for ${hold}s. Cope in emotes.` : `Slow mode ${hold}s. Breathe.`,
      undefined,
      broadcasterUserId,
    );
  }
  return true;
}

export async function maybeTriggeredEmoteMode(broadcasterUserId: number, insulted: boolean): Promise<void> {
  if (!insulted) return;
  if (Math.random() >= EMOTE_AUTO_CHANCE) return;
  if (!(await streamIsLive())) return;
  await pulseEmoteMode(broadcasterUserId);
}

export async function maybeRandomEmoteMode(broadcasterUserId: number): Promise<void> {
  if (!(await streamIsLive())) return;
  const now = Date.now();
  if (now - lastAuto < AUTO_COOLDOWN_MS) return;
  if (Math.random() >= EMOTE_AUTO_CHANCE) return;
  await pulseEmoteMode(broadcasterUserId, { seconds: 8 + Math.floor(Math.random() * 22) });
}

/** 20+ emotes from 5+ unique users in a short window → clip. */
export async function maybeAutoClip(broadcasterUserId: number, live: boolean): Promise<void> {
  if (!live) return;
  const now = Date.now();
  if (now - lastClip < CLIP_COOLDOWN_MS) return;
  const burst = detectLaughBurst(broadcasterUserId);
  if (!burst) return;
  const seconds = burst.emotes >= 40 ? 60 : 30;
  const ok = await createClip({ seconds, title: "chat lost it" });
  if (!ok) return;
  lastClip = now;
  await say("Clipped that. Chat is unhinged.", undefined, broadcasterUserId);
}

export async function handleStaffModAsk(chat: IncomingChat): Promise<string | null> {
  const t = chat.content.replace(/\s+/g, " ").trim();
  const low = t.toLowerCase();
  if (!looksLikeModOrder(low)) return null;
  const id = chat.broadcaster.user_id;

  if (isOff(low) && /emote/.test(low)) {
    if (!(await streamIsLive())) return "Stream is offline — not changing emote-only.";
    return (await setEmoteOnly(false)) ? "Emote-only is OFF." : fail("emote-only");
  }
  if (isOff(low) && /\bslow\b|yavaş/.test(low)) {
    return (await setSlowMode(false)) ? "Slow mode is OFF." : fail("slow mode");
  }
  if (isOff(low) && /follow|takipçi|takipci/.test(low)) {
    return (await setFollowOnly(false)) ? "Follower-only is OFF." : fail("follower-only");
  }
  if (isOff(low) && /\bsub(s|only)?\b|abone/.test(low)) {
    return (await setSubOnly(false)) ? "Sub-only is OFF." : fail("sub-only");
  }

  if (isClipOrder(low)) {
    const seconds = clipSeconds(low);
    const ok = await createClip({ seconds, title: clipTitle(t) });
    return ok ? `Clipping the last ${seconds}s.` : fail("clip — Kick may require the clipping program on this account");
  }

  if (/emote/.test(low)) {
    if (!(await streamIsLive())) return "Stream is offline — not changing emote-only.";
    const ok = await pulseEmoteMode(id, { force: true, seconds: holdSeconds(low, 20) });
    return ok ? "" : fail("emote-only");
  }

  if (/\bslow\b|yavaş/.test(low)) {
    const ok = await pulseSlowMode(id, { force: true, seconds: holdSeconds(low, 25), gapSec: 8 });
    return ok ? "" : fail("slow mode");
  }

  if (/follow|takipçi|takipci/.test(low)) {
    const on = !isOff(low);
    return (await setFollowOnly(on)) ? `Follower-only is ${on ? "ON" : "OFF"}.` : fail("follower-only");
  }

  if (/\bsub(s|only)?\b|sadece sub|abone only/.test(low)) {
    const on = !isOff(low);
    return (await setSubOnly(on)) ? `Sub-only is ${on ? "ON" : "OFF"}.` : fail("sub-only");
  }

  if (/\bclear\b|temizle|chat'?i sil/.test(low)) {
    return (await clearChat()) ? "Chat cleared." : fail("clear");
  }

  return null;
}

function looksLikeModOrder(low: string): boolean {
  if (low.length > 140) return false;
  if (/\b(clip|klip)\b/.test(low) && isClipOrder(low)) return true;
  if (/emote\s*(only|mod|mode)?|sadece emote/.test(low) && /\b(on|off|aç|kapat|al|yap|et|mode|mod)\b/.test(low)) return true;
  if (/\bslow\b|yavaş mod/.test(low) && /\b(on|off|aç|kapat|al|mode|mod)\b/.test(low)) return true;
  if (/follow\s*only|follower|takipçi only|takipci only/.test(low)) return true;
  if (/sub\s*only|sadece sub|abone only/.test(low)) return true;
  if (/clear chat|chat'?i temizle|sohbeti temizle/.test(low)) return true;
  return false;
}

function isClipOrder(low: string): boolean {
  if (!/\b(clip|klip)\b/.test(low)) return false;
  if (/^(clip|klip)\b/.test(low)) return true;
  return /\b(that|this|it|now|please|pls|al|at|çek|et|yap|şu|bunu|şunu|lütfen)\b/.test(low);
}

function isOff(low: string): boolean {
  return /\b(off|kapat|kapa|durdur|disable|bitir)\b/.test(low);
}

function holdSeconds(low: string, fallback: number): number {
  const n = low.match(/\b(\d{1,3})\s*(s|sec|secs|saniye)?\b/);
  if (!n) return fallback;
  return Math.min(60, Math.max(8, Number(n[1])));
}

function clipSeconds(low: string): number {
  const n = low.match(/\b(\d{2,3})\b/);
  if (!n) return 30;
  return Math.min(180, Math.max(10, Number(n[1])));
}

function clipTitle(text: string): string {
  const cut = text.replace(/^.*\b(clip|klip)\b/i, "").replace(/\b\d{1,3}\b/g, "").trim();
  if (cut.length < 3) return "chat lost it";
  return cut.slice(0, 48);
}

function fail(what: string): string {
  return `Couldn't change ${what}. CamelBot needs mod rights (and Kick slash commands) on this channel.`;
}

export function parseToggleArgs(args: string): "on" | "off" | "pulse" | number | "" {
  const t = args.trim().toLowerCase();
  if (!t) return "";
  if (t === "pulse") return "pulse";
  if (t === "on" || t === "1" || t === "true" || t === "aç") return "on";
  if (t === "off" || t === "0" || t === "false" || t === "kapat") return "off";
  if (/^\d+$/.test(t)) return Number(t);
  const bits = t.split(/\s+/);
  if (bits[0] === "on" && bits[1] && /^\d+$/.test(bits[1])) return Number(bits[1]);
  return "";
}
