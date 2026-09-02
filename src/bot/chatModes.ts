import {
  getMyChannelCached,
  sendChatCommand,
  type ModSlashResult,
} from "../kick/api.js";
import { detectLaughBurst } from "./chatLog.js";
import { say } from "./outbox.js";
import { skipSong } from "./songs.js";
import {
  isClearOrder,
  isClipOrder as slangClipOrder,
  isEmoteOrder,
  isFollowOrder,
  isOffOrder,
  isSkipOrder,
  isSlowOrder,
  isSubOrder,
  looksLikeModSlang,
} from "./slang.js";
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

export async function sendModSlash(command: string): Promise<ModSlashResult> {
  return sendChatCommand(command.trim());
}

export async function setEmoteOnly(on: boolean): Promise<boolean> {
  if (!(await streamIsLive())) {
    console.log("[emoteonly] skip, stream offline");
    return false;
  }
  return sendModSlash(on ? "/emoteonly on" : "/emoteonly off").then((r) => r.ok);
}

export async function setSlowMode(on: boolean, gapSec = 10): Promise<boolean> {
  if (!on) return sendModSlash("/slow off").then((r) => r.ok);
  const gap = Math.min(120, Math.max(3, Math.round(gapSec)));
  return sendModSlash(`/slow on ${gap}`).then((r) => r.ok);
}

export async function setFollowOnly(on: boolean): Promise<boolean> {
  return sendModSlash(on ? "/followonly on" : "/followonly off").then((r) => r.ok);
}

export async function setSubOnly(on: boolean): Promise<boolean> {
  return sendModSlash(on ? "/subonly on" : "/subonly off").then((r) => r.ok);
}

/** Kick only runs /clear from the browser — OAuth and pasted cookies cannot do it from a server. */
export async function clearChat(): Promise<ModSlashResult> {
  return { ok: false, reason: "kick_no_server_clear" };
}

export async function createClip(opts?: { seconds?: number; title?: string }): Promise<boolean> {
  const seconds = Math.min(180, Math.max(10, Math.round(opts?.seconds ?? 30)));
  const title = (opts?.title ?? "").replace(/[^\p{L}\p{N} _-]/gu, "").trim().slice(0, 48);
  const cmd = title ? `/clip ${seconds} ${title}` : `/clip ${seconds}`;
  return sendModSlash(cmd).then((r) => r.ok);
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
  if (!looksLikeModSlang(t)) return null;
  const id = chat.broadcaster.user_id;

  if (isOffOrder(t) && /emote/.test(low)) {
    if (!(await streamIsLive())) return "Stream is offline — not changing emote-only.";
    return (await setEmoteOnly(false)) ? "" : fail("emote-only");
  }
  if (isOffOrder(t) && isSlowOrder(t)) {
    return (await setSlowMode(false)) ? "" : fail("slow mode");
  }
  if (isOffOrder(t) && isFollowOrder(t)) {
    return (await setFollowOnly(false)) ? "" : fail("follower-only");
  }
  if (isOffOrder(t) && isSubOrder(t)) {
    return (await setSubOnly(false)) ? "" : fail("sub-only");
  }

  if (slangClipOrder(t)) {
    const seconds = clipSeconds(low);
    const ok = await createClip({ seconds, title: clipTitle(t) });
    return ok ? "" : fail("clip — Kick may require the clipping program on this account");
  }

  if (isEmoteOrder(t)) {
    if (!(await streamIsLive())) return "Stream is offline — not changing emote-only.";
    if (/\bpulse\b/.test(low) || /\b\d{1,3}\s*(s|sec|secs|saniye)\b/.test(low)) {
      const ok = await pulseEmoteMode(id, { force: true, seconds: holdSeconds(low, 20) });
      return ok ? "" : fail("emote-only");
    }
    return (await setEmoteOnly(true)) ? "" : fail("emote-only");
  }

  if (isSlowOrder(t)) {
    if (/\bpulse\b/.test(low) || /\b\d{1,3}\s*(s|sec|secs|saniye)\b/.test(low)) {
      const ok = await pulseSlowMode(id, { force: true, seconds: holdSeconds(low, 25), gapSec: 8 });
      return ok ? "" : fail("slow mode");
    }
    return (await setSlowMode(true, holdSeconds(low, 10))) ? "" : fail("slow mode");
  }

  if (isFollowOrder(t)) {
    return (await setFollowOnly(!isOffOrder(t))) ? "" : fail("follower-only");
  }

  if (isSubOrder(t)) {
    return (await setSubOnly(!isOffOrder(t))) ? "" : fail("sub-only");
  }

  if (isClearOrder(t)) {
    const cleared = await clearChat();
    return cleared.ok ? "" : fail("clear", cleared.reason);
  }

  if (isSkipOrder(t)) {
    const skipped = skipSong();
    return skipped ? "" : "Queue is already empty.";
  }

  return null;
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

function fail(what: string, reason?: string): string {
  const base = `Couldn't change ${what}. CamelBot needs mod rights (and Kick slash commands) on this channel.`;
  return reason ? `${base.slice(0, -1)} (${reason}).` : base;
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
