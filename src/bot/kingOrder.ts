import { generateRaw } from "./ai.js";
import {
  getMyChannel,
  pinChatMessage,
  searchCategories,
  sendChat,
  sendChatCommand,
  unpinChatMessage,
  updateStreamCategory,
  updateStreamTitle,
} from "../kick/api.js";
import {
  clearChat,
  createClip,
  pulseEmoteMode,
  pulseSlowMode,
  setEmoteOnly,
  setFollowOnly,
  setSlowMode,
  setSubOnly,
  streamIsLive,
} from "./chatModes.js";
import {
  interpretOrder,
  isHomeChannelRef,
  mightBeKingOrder,
  needsAiInterpretation,
  parseCommandInvoke,
  parseHomeSay,
  resolveRaidTarget,
  resolveSayChannel,
  splitCompoundOrder,
  type InterpretedOrder,
} from "./orderInterpret.js";
import { handleCommand } from "./commands.js";
import { config } from "../config.js";
import { skipSong } from "./songs.js";
import { parseRemoteSay, runRemoteSay, extractChannelTarget } from "./remoteSay.js";
import { lookupPublicChannel } from "../kick/publicChannel.js";
import { extraChannels } from "./channelStore.js";
import {
  extractQuoted,
  isCategoryOrder,
  isClearOrder,
  isClipOrder,
  isEmoteOrder,
  isFollowOrder,
  isOffOrder,
  isPinOrder,
  isRaidOrder,
  isSkipOrder,
  isSlowOrder,
  isSubOrder,
  isTitleOrder,
  isUnpinOrder,
} from "./slang.js";
import type { ChatLang } from "./lang.js";
import type { IncomingChat } from "../types.js";

export { mightBeKingOrder };

type KingOrder = InterpretedOrder;

export async function runKingOrder(
  content: string,
  lang: ChatLang,
  broadcasterUserId: number,
): Promise<string | null | undefined> {
  const t = content.replace(/\s+/g, " ").trim();
  if (!t) return undefined;

  const parts = splitCompoundOrder(t);
  if (parts.length > 1) {
    for (const part of parts) {
      const result = await runKingOrderPart(part, lang, broadcasterUserId);
      if (result) return result;
    }
    return null;
  }

  return runKingOrderPart(t, lang, broadcasterUserId);
}

async function runKingOrderPart(
  content: string,
  lang: ChatLang,
  broadcasterUserId: number,
): Promise<string | null | undefined> {
  const t = content.replace(/\s+/g, " ").trim();
  if (!t) return undefined;

  let homeSlug = "";
  try {
    homeSlug = (await getMyChannel()).slug.toLowerCase();
  } catch {
    homeSlug = "mcvckaharamamm";
  }

  const cmd = parseCommandInvoke(t);
  if (cmd) return execute(cmd, lang, broadcasterUserId, t, homeSlug);

  const homeSay = parseHomeSay(t);
  if (homeSay) return execute(homeSay, lang, broadcasterUserId, t, homeSlug);

  const fast = parseLocalOrder(t);
  if (
    fast &&
    (fast.action === "clear" ||
      fast.action === "skip" ||
      fast.action === "unpin" ||
      (fast.action === "pin" && fast.text))
  ) {
    return execute(fast, lang, broadcasterUserId, t, homeSlug);
  }

  if (needsAiInterpretation(t) || !fast) {
    const ai = await interpretOrder(t, broadcasterUserId, homeSlug);
    if (ai && ai.action !== "none") {
      return execute(ai, lang, broadcasterUserId, t, homeSlug);
    }
  }

  const remote = parseRemoteSay(t, lang);
  if (remote) return runRemoteSay(remote, lang);

  if (fast) return execute(fast, lang, broadcasterUserId, t, homeSlug);

  const legacy = await interpretLegacy(t);
  if (legacy && legacy.action !== "none") {
    return execute(legacy, lang, broadcasterUserId, t, homeSlug);
  }

  return undefined;
}

const KING_ID = 549839;
const KING_NAME = "mcvckaharamamm";

function kingIncoming(content: string, home: { broadcaster_user_id: number; slug: string }): IncomingChat {
  return {
    messageId: `king-${Date.now()}`,
    content,
    sender: {
      user_id: KING_ID,
      username: KING_NAME,
      channel_slug: home.slug,
    },
    broadcaster: {
      user_id: home.broadcaster_user_id,
      username: home.slug,
      channel_slug: home.slug,
    },
  };
}

function parseLocalOrder(content: string): KingOrder | null {
  const t = content.replace(/\s+/g, " ").trim();
  if (!t) return null;

  if (isClearOrder(t)) return { action: "clear" };
  if (isSkipOrder(t)) return { action: "skip" };
  if (isUnpinOrder(t)) return { action: "unpin" };

  if (isPinOrder(t)) {
    const quoted = extractQuoted(t);
    if (quoted) return { action: "pin", text: quoted };
  }

  if (isTitleOrder(t)) {
    const title = matchValue(t, [
      /(?:change|set|update|değiştir|degistir)\s+(?:the\s+)?(?:stream\s+)?(?:title|başlık|baslik)\s+(?:to\s+|as\s+)?(.+)/i,
      /(?:title|başlığ?[ıi]?|basligi?)\s*(?:['']?[ıi])?\s*(?:to|as|yap|:|=|olsun)\s+(.+)/i,
      /başlığı?\s+(.+?)\s+(?:yap|olsun)\s*$/i,
    ]);
    if (title) return { action: "title", text: stripOrderJunk(title) };
  }

  if (isCategoryOrder(t)) {
    const category = matchValue(t, [
      /(?:change|set|update|değiştir|degistir)\s+(?:the\s+)?(?:category|game|kategori)\s+(?:to\s+|as\s+)?(.+)/i,
      /(?:category|kategori|game)\s*(?:['']?[ıi])?\s*(?:to|as|yap|:|=|olsun)\s+(.+)/i,
      /kategoriyi?\s+(.+?)\s+(?:yap|olsun)\s*$/i,
    ]);
    if (category) return { action: "category", text: stripOrderJunk(category) };
  }

  if (isRaidOrder(t)) {
    const who = extractChannelTarget(t);
    if (who) return { action: "raid", channel: who, text: who };
  }

  if (isEmoteOrder(t)) {
    return { action: "emoteonly", on: !isOffOrder(t), seconds: holdSeconds(t) };
  }

  if (isSlowOrder(t)) {
    return { action: "slow", on: isOffOrder(t) ? false : true, seconds: holdSeconds(t) };
  }

  if (isFollowOrder(t)) return { action: "followonly", on: !isOffOrder(t) };
  if (isSubOrder(t)) return { action: "subonly", on: !isOffOrder(t) };

  if (isClipOrder(t)) {
    return { action: "clip", seconds: holdSeconds(t) ?? 30, text: "CamelBot clip" };
  }

  return null;
}

function matchValue(text: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const hit = text.match(re)?.[1]?.trim();
    if (hit) return hit;
  }
  return null;
}

function stripOrderJunk(value: string): string {
  return value
    .replace(/\b(?:@?camelbot|@?camel|bot|pls|please|lütfen|lutfen)\b/gi, " ")
    .replace(/[?!.,]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function holdSeconds(low: string): number | null {
  const n = low.match(/\b(\d{1,3})\s*(s|sec|secs|saniye)?\b/);
  if (!n) return null;
  return Math.min(180, Math.max(5, Number(n[1])));
}

async function interpretLegacy(content: string): Promise<KingOrder | null> {
  const raw = await generateRaw(
    [
      `Streamer order: ${content.slice(0, 280)}`,
      'Reply JSON only: {"action":"none|say|clear|skip|title|category|emoteonly|slow|followonly|subonly|clip|raid","channel":"","text":"","on":null,"seconds":null}',
    ].join("\n"),
    "Convert one chat order to JSON. No markdown.",
    { standalone: true, timeoutMs: 5000, tokens: 120, temperature: 0 },
  );
  if (!raw) return null;
  const json = raw.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as { action?: string; channel?: string; text?: string; on?: boolean | null; seconds?: number | null };
    const action = parsed.action === "host" ? "raid" : parsed.action;
    if (!action || action === "none") return action === "none" ? { action: "none" } : null;
    return { ...parsed, action: action as KingOrder["action"] };
  } catch {
    return null;
  }
}

async function execute(
  order: KingOrder,
  lang: ChatLang,
  broadcasterUserId: number,
  original: string,
  homeSlug: string,
): Promise<string | null | undefined> {
  const fail = (en: string, tr: string, reason?: string) => {
    const msg = lang === "en" ? en : tr;
    return reason ? `${msg} (${reason})` : msg;
  };
  switch (order.action) {
    case "say": {
      const text = (order.text || "").trim();
      if (!text) return fail("Say what?", "Ne yazayım?");
      const slug = resolveSayChannel(order, original, homeSlug);
      if (!slug) return fail("That channel is not in my list.", "O kanal kayıtlı değil.");
      if (slug === homeSlug || isHomeChannelRef(original, homeSlug)) {
        const id = await sendChat(text);
        return id ? null : fail("Couldn't post that message.", "Mesaj yazılamadı.");
      }
      return runRemoteSay({ slug, text }, lang);
    }
    case "command": {
      const prefix = config.bot.prefix;
      let cmdLine = (order.text || "").trim();
      if (!cmdLine) {
        const parsed = parseCommandInvoke(original);
        cmdLine = parsed?.text?.trim() ?? "";
      }
      if (!cmdLine) return fail("Which command?", "Hangi komut?");
      if (!cmdLine.startsWith(prefix)) cmdLine = `${prefix}${cmdLine.replace(/^!+/, "")}`;
      const home = await getMyChannel();
      const reply = await handleCommand(kingIncoming(cmdLine, home));
      if (reply === null) return fail("Unknown command.", "Bilinmeyen komut.");
      const id = await sendChat(reply);
      return id ? null : fail("Couldn't run that command.", "Komut çalıştırılamadı.");
    }
    case "clear": {
      const cleared = await clearChat();
      if (cleared.ok) return null;
      return fail(
        "Kick won't run /clear from a bot — type /clear in chat or use the Kick dashboard.",
        "Kick bot'tan /clear çalıştırmıyor — chatte /clear yaz veya Kick panelini kullan.",
      );
    }
    case "skip": {
      const skipped = skipSong();
      return skipped ? null : fail("Queue is empty.", "Kuyruk boş.");
    }
    case "title": {
      const title = (order.text || "").trim().slice(0, 100);
      if (!title) return fail("What title?", "Başlık ne olsun?");
      try {
        await updateStreamTitle(title);
        return null;
      } catch {
        return fail("Couldn't update the title.", "Başlık değişmedi.");
      }
    }
    case "category": {
      const name = (order.text || "").trim();
      if (!name) return fail("What category?", "Kategori ne olsun?");
      try {
        const hits = await searchCategories(name);
        const pick = hits[0];
        if (!pick) return fail("No matching category.", "Öyle bir kategori yok.");
        await updateStreamCategory(pick.id);
        return null;
      } catch {
        return fail("Couldn't update the category.", "Kategori değişmedi.");
      }
    }
    case "emoteonly": {
      if (!(await streamIsLive())) return fail("Stream is offline.", "Yayın kapalı.");
      if (order.on === false) {
        return (await setEmoteOnly(false)) ? null : fail("Couldn't change emote-only.", "Emote-only değişmedi.");
      }
      if (order.on === true) {
        return (await setEmoteOnly(true)) ? null : fail("Couldn't change emote-only.", "Emote-only değişmedi.");
      }
      const ok = await pulseEmoteMode(broadcasterUserId, {
        force: true,
        seconds: order.seconds ?? 20,
        announce: false,
      });
      return ok ? null : fail("Couldn't change emote-only.", "Emote-only değişmedi.");
    }
    case "slow": {
      if (order.on === false) {
        return (await setSlowMode(false)) ? null : fail("Couldn't change slow mode.", "Slow mode değişmedi.");
      }
      if (typeof order.seconds === "number" && order.seconds > 0) {
        return (await setSlowMode(true, order.seconds))
          ? null
          : fail("Couldn't change slow mode.", "Slow mode değişmedi.");
      }
      const ok = await pulseSlowMode(broadcasterUserId, { force: true, announce: false });
      return ok ? null : fail("Couldn't change slow mode.", "Slow mode değişmedi.");
    }
    case "followonly":
      return (await setFollowOnly(order.on !== false))
        ? null
        : fail("Couldn't change follower-only.", "Follower-only değişmedi.");
    case "subonly":
      return (await setSubOnly(order.on !== false)) ? null : fail("Couldn't change sub-only.", "Sub-only değişmedi.");
    case "clip": {
      const ok = await createClip({ seconds: order.seconds ?? 30, title: order.text || "CamelBot clip" });
      return ok ? null : fail("Couldn't clip.", "Klip alınamadı.");
    }
    case "raid": {
      const who = resolveRaidTarget(order, original);
      if (!who) return fail("Raid whom?", "Kimi raidleyeyim?");
      const ok = (await sendChatCommand(`/host ${who}`)).ok || (await sendChatCommand(`/raid ${who}`)).ok;
      return ok ? null : fail("Couldn't raid/host that channel.", "Raid/host gitmedi.");
    }
    case "pin": {
      const text = (order.text || "").trim();
      if (!text) return fail("Pin what message?", "Ne sabitleyeyim?");
      const home = await getMyChannel();
      const slug = resolveSayChannel(order, original, homeSlug) || home.slug.toLowerCase();
      const targetUserId = await targetUserIdForSlug(slug, home.broadcaster_user_id);
      const msgId = await sendChat(text, undefined, targetUserId);
      if (!msgId) return fail("Couldn't post that message.", "Mesaj yazılamadı.");
      await new Promise((resolve) => setTimeout(resolve, 450));
      const ok = await pinChatMessage(msgId, slug);
      return ok ? null : fail("Posted but couldn't pin it.", "Yazdım ama sabitleyemedim.");
    }
    case "unpin": {
      const home = await getMyChannel();
      const slug = resolveSayChannel(order, original, homeSlug) || home.slug.toLowerCase();
      const ok = await unpinChatMessage(slug);
      return ok ? null : fail("Couldn't unpin.", "Sabitleme kaldırılamadı.");
    }
    default:
      return undefined;
  }
}

async function targetUserIdForSlug(slug: string, homeUserId: number): Promise<number | undefined> {
  const home = await getMyChannel();
  if (slug === home.slug.toLowerCase()) return undefined;
  const saved = extraChannels().find((c) => c.slug === slug);
  if (saved?.userId) return saved.userId;
  try {
    return (await lookupPublicChannel(slug)).userId;
  } catch {
    return homeUserId;
  }
}
