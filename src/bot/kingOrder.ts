import { botFail, botInfo, botOk, botThink, botWarn } from "./activityLog.js";
import { generateRaw } from "./ai.js";
import {
  getMyChannel,
  pinChatMessage,
  searchCategories,
  sendChat,
  sendChatCommand,
  timeoutOrBan,
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
  interpretOrders,
  isHomeChannelRef,
  mightBeKingOrder,
  parseCommandInvoke,
  parseHomeSay,
  resolveRaidTarget,
  resolveSayChannel,
  shouldTryKingOrder,
  splitCompoundOrder,
  type InterpretedOrder,
} from "./orderInterpret.js";
import { handleCommand } from "./commands.js";
import { config } from "../config.js";
import { skipSong } from "./songs.js";
import { parseRemoteSay, runRemoteSay, extractChannelTarget, resolveRegisteredChannel } from "./remoteSay.js";
import { lookupPublicChannel } from "../kick/publicChannel.js";
import { extraChannels } from "./channelStore.js";
import { formatLastChat, lastBotQuotedText, lastChatLines } from "./chatLog.js";
import { chatSummary } from "./chatMemory.js";
import {
  extractQuoted,
  fold,
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
import {
  looksLikeDiscordVoiceOrder,
  parseDiscordVoiceOrderHeuristic,
  runDiscordVoiceBridge,
} from "../discord/bridge.js";
import { findKickEmote, pickRandomKickEmote, formatKickEmote, spamKickEmote, detectEmoteMoodRequest, formatMoodEmoteBurst, type EmoteMood } from "./kickEmotes.js";
import { say } from "./outbox.js";

export { mightBeKingOrder, shouldTryKingOrder };

type KingOrder = InterpretedOrder;

export async function runKingOrder(
  content: string,
  lang: ChatLang,
  broadcasterUserId: number,
): Promise<string | null | undefined> {
  const t = content.replace(/\s+/g, " ").trim();
  if (!t) return undefined;

  botInfo("order", `Heard: ${t.slice(0, 160)}`);

  let homeSlug = "";
  try {
    homeSlug = (await getMyChannel()).slug.toLowerCase();
  } catch {
    homeSlug = "mcvckaharamamm";
  }

  // Fast path for unambiguous single mechanical commands.
  const cmd = parseCommandInvoke(t);
  if (cmd) return finish(await execute(cmd, lang, broadcasterUserId, t, homeSlug), cmd.action);
  if (isClearOrder(t) && splitCompoundOrder(t).length === 1) {
    return finish(await execute({ action: "clear" }, lang, broadcasterUserId, t, homeSlug), "clear");
  }
  if (isSkipOrder(t) && splitCompoundOrder(t).length === 1) {
    return finish(await execute({ action: "skip" }, lang, broadcasterUserId, t, homeSlug), "skip");
  }

  // Kick → Discord voice: "benim olduğum DC kanalına gir ve selam kralım de"
  if (looksLikeDiscordVoiceOrder(t)) {
    const dc = parseDiscordVoiceOrderHeuristic(t);
    if (dc) {
      botThink("order", `Discord voice heuristic → ${dc.mode ?? "join"} ${dc.say?.slice(0, 40) ?? ""}`);
      return finish(
        await execute(
          {
            action: "discord_voice",
            text: dc.say || dc.topic,
            mode: dc.leave
              ? "leave"
              : dc.mode === "join_only"
                ? "join"
                : dc.mode === "riff"
                  ? "riff"
                  : dc.mode || "verbatim",
          },
          lang,
          broadcasterUserId,
          t,
          homeSlug,
        ),
        "discord_voice",
      );
    }
  }

  // "bizim chate emoji atsana" / "go laugh" / send angry emotes
  if (looksLikeEmoteDropOrder(t)) {
    const mood = detectEmoteMoodRequest(t);
    return finish(
      await execute(
        { action: "emote", text: extractNamedEmote(t), mode: mood ?? undefined },
        lang,
        broadcasterUserId,
        t,
        homeSlug,
      ),
      "emote",
    );
  }

  // AI can return multiple orders from one message.
  botThink("order", "Understanding intent (may be multi-order)…");
  let aiOrders: InterpretedOrder[] = [];
  try {
    aiOrders = await interpretOrders(t, broadcasterUserId, homeSlug);
  } catch (err) {
    botFail("order", `Understand crash: ${err instanceof Error ? err.message : String(err)}`);
    aiOrders = [];
  }

  if (aiOrders.length === 1 && aiOrders[0]?.action === "none") {
    botThink("order", "Understood as chat (not an executable order)");
    return undefined;
  }

  const executable = aiOrders.filter((o) => o.action !== "none");

  // If AI only returned one action but the text clearly has parallel asks, split and fill gaps.
  if (executable.length <= 1) {
    const parts = splitCompoundOrder(t);
    if (parts.length > 1) {
      botThink("order", `Splitting into ${parts.length} parts for multi-order`);
      const msgs: string[] = [];
      let any = false;
      for (const part of parts) {
        const result = await runKingOrderPart(part, lang, broadcasterUserId, homeSlug);
        if (result === undefined) continue;
        any = true;
        if (result) msgs.push(result);
      }
      if (!any) return undefined;
      return msgs.length ? msgs.join(" · ") : null;
    }
  }

  if (executable.length > 0) {
    botThink("order", `Executing ${executable.length} order(s)`);
    const msgs: string[] = [];
    for (const order of executable) {
      botThink("order", `→ ${order.action}${order.text ? `: ${order.text.slice(0, 80)}` : ""}`);
      try {
        const result = finish(await execute(order, lang, broadcasterUserId, t, homeSlug), order.action);
        if (result) msgs.push(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        botFail("order", `Execute crash (${order.action}): ${msg}`);
        msgs.push(lang === "en" ? `Order failed: ${msg}` : `Komut patladı: ${msg}`);
      }
    }
    return msgs.length ? msgs.join(" · ") : null;
  }

  // Fallbacks if AI failed entirely
  return runKingOrderPart(t, lang, broadcasterUserId, homeSlug);
}

async function runKingOrderPart(
  content: string,
  lang: ChatLang,
  broadcasterUserId: number,
  homeSlugIn?: string,
): Promise<string | null | undefined> {
  const t = content.replace(/\s+/g, " ").trim();
  if (!t) return undefined;

  let homeSlug = homeSlugIn ?? "";
  if (!homeSlug) {
    try {
      homeSlug = (await getMyChannel()).slug.toLowerCase();
    } catch {
      homeSlug = "mcvckaharamamm";
    }
  }

  const cmd = parseCommandInvoke(t);
  if (cmd) return finish(await execute(cmd, lang, broadcasterUserId, t, homeSlug), cmd.action);

  if (isClearOrder(t)) {
    return finish(await execute({ action: "clear" }, lang, broadcasterUserId, t, homeSlug), "clear");
  }
  if (isSkipOrder(t)) {
    return finish(await execute({ action: "skip" }, lang, broadcasterUserId, t, homeSlug), "skip");
  }

  botThink("order", `Understanding part: ${t.slice(0, 100)}`);
  let aiOrders: InterpretedOrder[] = [];
  try {
    aiOrders = await interpretOrders(t, broadcasterUserId, homeSlug);
  } catch (err) {
    botFail("order", `Understand crash: ${err instanceof Error ? err.message : String(err)}`);
    aiOrders = [];
  }

  const executable = aiOrders.filter((o) => o.action !== "none");
  if (executable.length > 0) {
    const msgs: string[] = [];
    for (const order of executable) {
      try {
        const result = finish(await execute(order, lang, broadcasterUserId, t, homeSlug), order.action);
        if (result) msgs.push(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        botFail("order", `Execute crash (${order.action}): ${msg}`);
        msgs.push(lang === "en" ? `Order failed: ${msg}` : `Komut patladı: ${msg}`);
      }
    }
    return msgs.length ? msgs.join(" · ") : null;
  }
  if (aiOrders.some((o) => o.action === "none")) {
    botThink("order", "Part understood as chat");
    return undefined;
  }

  const homeSay = parseHomeSay(t);
  if (homeSay) return finish(await execute(homeSay, lang, broadcasterUserId, t, homeSlug), homeSay.action);

  const remote = parseRemoteSay(t, lang);
  if (remote) {
    botThink("order", `Remote say → ${remote.slug}`);
    return finish(await runRemoteSay(remote, lang), "say");
  }

  const fast = parseLocalOrder(t);
  if (fast) {
    botThink("order", `Local fallback → ${fast.action}${fast.text ? `: ${fast.text.slice(0, 80)}` : ""}`);
    return finish(await execute(fast, lang, broadcasterUserId, t, homeSlug), fast.action);
  }

  botWarn("order", "Could not understand order part");
  return undefined;
}

function finish(result: string | null | undefined, action: string): string | null | undefined {
  if (result === undefined) return undefined;
  if (result === null) {
    botOk("order", `${action} done (silent)`);
    return null;
  }
  const failed =
    /couldn't|could not|^no matching|^kick won't|^queue is empty|^what |^which |^raid whom|^say what|^pin what|^unknown|^stream is offline|yay[ıi]n kapal[ıi]|kuyruk bo[sş]|yaz[ıi]lamad[ıi]|de[gğ]i[sş]medi|[cç]al[ıi][sş]t[ıi]r[ıi]lamad[ıi]|al[ıi]namad[ıi]|gitmedi|kald[ıi]r[ıi]lamad[ıi]|kategori yok|i[cç]in kategori yok|ne olsun|hangi komut|kimi raid|ne yazay[ıi]m|ne sabitle/i.test(
      result,
    );
  if (failed) botFail("order", `${action}: ${result}`);
  else botOk("order", `${action}: ${result}`);
  return result;
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
    // "tamam öyle yap başlığı" / "yap başlığı" — apply suggested/invented title
    if (isApplySuggestedTitle(t)) return { action: "title", text: "__invent__" };
  }

  if (isCategoryOrder(t)) {
    const category = matchValue(t, [
      /(?:benim|bizim|yayının|yayinin|stream(?:in)?)?\s*(?:oyun(?:u|umu|unu)?|game(?:'i|'ı)?)\s+(.+?)\s+(?:ye|ya|to)\s*(?:çevir|cevir|çevirsene|cevirsene|yap)/i,
      /(?:benim|bizim)?\s*(?:oyun(?:u|umu|unu)?|game)\s+(.+?)\s*(?:yap|olsun|çevir|cevir)/i,
      /(?:change|set|update|değiştir|degistir|çevir|cevir)\s+(?:the\s+)?(?:category|game|kategori|oyun(?:u)?)\s+(?:to\s+|as\s+|ye\s+|ya\s+)?(.+)/i,
      /(?:category|kategori|game|oyun(?:u)?)\s*(?:['']?[ıi])?\s*(?:to|as|yap|:|=|olsun|ye|ya)\s+(.+)/i,
      /kategoriyi?\s+(.+?)\s+(?:yap|olsun|çevir|cevir)\s*$/i,
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

function isApplySuggestedTitle(text: string): boolean {
  const f = fold(text);
  return (
    /(?:oyle|aynen|tamam|ok).{0,28}(?:yap|degistir|guncelle).{0,20}(?:baslik|title)/.test(f) ||
    /(?:yap|degistir|guncelle)\s+(?:su\s+|o\s+)?(?:basligi?|title)\b/.test(f) ||
    /(?:basligi?|title(?:yi)?)\s*(?:degistir|guncelle|yap)\b/.test(f)
  );
}

function isVagueTitleValue(text: string): boolean {
  const f = fold(text).replace(/['"`]/g, "").trim();
  if (!f || f === "__invent__") return true;
  return (
    /^(whatever|anything|something|oyle|aynen|bunu|onu|sunu|same|that|this|it)$/.test(f) ||
    /whatever you want|anything you want|ne istersen|istedigin gibi|sen (sec|karar|belirle|koy)|o baslik|that title|your (choice|pick|call)/.test(
      f,
    )
  );
}

async function resolveTitleText(
  raw: string,
  broadcasterUserId: number,
  lang: ChatLang,
): Promise<string | null> {
  const cleaned = stripOrderJunk(raw);
  if (!isVagueTitleValue(cleaned)) return cleaned.slice(0, 100);

  const quoted = lastBotQuotedText(broadcasterUserId);
  if (quoted) {
    botThink("order", `Reusing last suggested title: ${quoted.slice(0, 80)}`);
    return quoted.slice(0, 100);
  }

  botThink("order", "Inventing a stream title…");
  let game = "";
  let currentTitle = "";
  try {
    const ch = await getMyChannel();
    game = ch.category?.name ?? "";
    currentTitle = ch.stream_title ?? "";
  } catch {
    /* ignore */
  }
  const invented = await generateRaw(
    [
      `Invent ONE short Kick stream title (max 80 chars).`,
      `Language: ${lang === "en" ? "English" : "Turkish"}.`,
      game ? `Current game/category: ${game}` : "",
      currentTitle ? `Current title (make something fresher): ${currentTitle}` : "",
      chatSummary(broadcasterUserId)
        ? `What chat has been talking about: ${chatSummary(broadcasterUserId)}`
        : "",
      formatLastChat(broadcasterUserId, 10)
        ? `Last 10 chat lines:\n${formatLastChat(broadcasterUserId, 10)}`
        : "",
      `Streamer vibe: chaotic Turkish Kick chat, Yenimahalle / camel jokes ok.`,
      `If chat has a live topic, lean into it. Reply with the title only — no quotes, no explanation.`,
    ]
      .filter(Boolean)
      .join("\n"),
    "You invent stream titles. Plain text only. Use chat topic when it helps.",
    { standalone: true, timeoutMs: 90_000, tokens: 60, temperature: 0.9 },
  );
  const title = invented?.replace(/^["“”']+|["“”']+$/g, "").trim().slice(0, 100);
  return title || null;
}

/** Expand common shorthand so Kick category search finds the right game. */
function expandCategoryQuery(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  const low = t.toLowerCase().replace(/\s+/g, " ");
  const aliases: Array<[RegExp, string]> = [
    [/^poe\s*2$/i, "Path of Exile 2"],
    [/^poe2$/i, "Path of Exile 2"],
    [/^path of exile\s*2$/i, "Path of Exile 2"],
    [/^poe$/i, "Path of Exile"],
    [/^dota\s*2?$/i, "Dota 2"],
    [/^lol$/i, "League of Legends"],
    [/^cs2$/i, "Counter-Strike"],
    [/^cs\s*2$/i, "Counter-Strike"],
    [/^jc$/i, "Just Chatting"],
    [/^just chatting$/i, "Just Chatting"],
  ];
  for (const [re, name] of aliases) {
    if (re.test(low)) return name;
  }
  return t;
}

function holdSeconds(low: string): number | null {
  const n = low.match(/\b(\d{1,3})\s*(s|sec|secs|saniye)?\b/);
  if (!n) return null;
  return Math.min(180, Math.max(5, Number(n[1])));
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
  const ok = (en: string, tr: string) => (lang === "en" ? en : tr);

  switch (order.action) {
    case "say": {
      const text = (order.text || "").trim();
      if (!text) return fail("Say what?", "Ne yazayım?");
      let slug = resolveSayChannel(order, original, homeSlug);
      // Default to home unless they clearly named another registered channel.
      if (!slug) {
        const remote = resolveRegisteredChannel(original) || resolveRegisteredChannel(order.channel || "");
        if (remote && remote !== homeSlug) {
          slug = remote;
        } else {
          slug = homeSlug;
        }
      }
      if (!slug) return fail("That channel is not in my list.", "O kanal kayıtlı değil.");
      if (slug === homeSlug || isHomeChannelRef(original, homeSlug)) {
        const id = await sendChat(text);
        // Posted text is the proof — no second ack spam.
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
      if (reply.trim()) {
        const id = await sendChat(reply);
        return id ? null : fail("Couldn't run that command.", "Komut çalıştırılamadı.");
      }
      return ok(`Ran ${cmdLine}.`, `${cmdLine} çalıştı.`);
    }
    case "clear": {
      const cleared = await clearChat();
      if (cleared.ok) return ok("Chat cleared.", "Chat temizlendi.");
      return fail(
        `Couldn't clear chat (${cleared.reason}). Paste fresh Kick site cookies (session_token) on the dashboard.`,
        `Chat temizlenemedi (${cleared.reason}). Dashboard'a yeni Kick site cookie (session_token) yapıştır.`,
      );
    }
    case "skip": {
      const skipped = skipSong();
      return skipped ? ok("Skipped.", "Şarkı geçildi.") : fail("Queue is empty.", "Kuyruk boş.");
    }
    case "title": {
      const title = await resolveTitleText(order.text || "", broadcasterUserId, lang);
      if (!title) return fail("What title?", "Başlık ne olsun?");
      try {
        await updateStreamTitle(title);
        return ok(`Title → ${title}`, `Başlık → ${title}`);
      } catch {
        return fail("Couldn't update the title.", "Başlık değişmedi.");
      }
    }
    case "category": {
      const name = expandCategoryQuery((order.text || "").trim());
      if (!name) return fail("What category?", "Kategori ne olsun?");
      try {
        const hits = await searchCategories(name);
        if (!hits.length) return fail(`No matching category for "${name}".`, `"${name}" için kategori yok.`);
        const wanted = name.toLowerCase();
        const pick =
          hits.find((h) => h.name.toLowerCase() === wanted) ||
          hits.find((h) => h.name.toLowerCase().startsWith(wanted)) ||
          hits.find((h) => h.name.toLowerCase().includes(wanted)) ||
          hits[0]!;
        await updateStreamCategory(pick.id);
        return ok(`Category → ${pick.name}`, `Kategori → ${pick.name}`);
      } catch {
        return fail("Couldn't update the category.", "Kategori değişmedi.");
      }
    }
    case "emoteonly": {
      if (!(await streamIsLive())) return fail("Stream is offline.", "Yayın kapalı.");
      if (order.on === false) {
        return (await setEmoteOnly(false))
          ? ok("Emote-only off.", "Emote-only kapalı.")
          : fail("Couldn't change emote-only.", "Emote-only değişmedi.");
      }
      if (order.on === true) {
        return (await setEmoteOnly(true))
          ? ok("Emote-only on.", "Emote-only açık.")
          : fail("Couldn't change emote-only.", "Emote-only değişmedi.");
      }
      const secs = order.seconds ?? 20;
      const pulseOk = await pulseEmoteMode(broadcasterUserId, {
        force: true,
        seconds: secs,
        announce: false,
      });
      return pulseOk
        ? ok(`Emote-only ${secs}s.`, `Emote-only ${secs}sn.`)
        : fail("Couldn't change emote-only.", "Emote-only değişmedi.");
    }
    case "slow": {
      if (order.on === false) {
        return (await setSlowMode(false))
          ? ok("Slow mode off.", "Slow mode kapalı.")
          : fail("Couldn't change slow mode.", "Slow mode değişmedi.");
      }
      if (typeof order.seconds === "number" && order.seconds > 0) {
        return (await setSlowMode(true, order.seconds))
          ? ok(`Slow mode ${order.seconds}s.`, `Slow mode ${order.seconds}sn.`)
          : fail("Couldn't change slow mode.", "Slow mode değişmedi.");
      }
      const slowOk = await pulseSlowMode(broadcasterUserId, { force: true, announce: false });
      return slowOk ? ok("Slow mode pulsed.", "Slow mode açıldı.") : fail("Couldn't change slow mode.", "Slow mode değişmedi.");
    }
    case "followonly":
      return (await setFollowOnly(order.on !== false))
        ? ok(
            order.on === false ? "Follower-only off." : "Follower-only on.",
            order.on === false ? "Follower-only kapalı." : "Follower-only açık.",
          )
        : fail("Couldn't change follower-only.", "Follower-only değişmedi.");
    case "subonly":
      return (await setSubOnly(order.on !== false))
        ? ok(order.on === false ? "Sub-only off." : "Sub-only on.", order.on === false ? "Sub-only kapalı." : "Sub-only açık.")
        : fail("Couldn't change sub-only.", "Sub-only değişmedi.");
    case "clip": {
      const clipOk = await createClip({ seconds: order.seconds ?? 30, title: order.text || "CamelBot clip" });
      return clipOk ? ok("Clip saved.", "Klip alındı.") : fail("Couldn't clip.", "Klip alınamadı.");
    }
    case "raid": {
      const who = resolveRaidTarget(order, original);
      if (!who) return fail("Raid whom?", "Kimi raidleyeyim?");
      const raidOk = (await sendChatCommand(`/host ${who}`)).ok || (await sendChatCommand(`/raid ${who}`)).ok;
      return raidOk ? ok(`Raiding/hosting ${who}.`, `Raid/host → ${who}`) : fail("Couldn't raid/host that channel.", "Raid/host gitmedi.");
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
      const pinOk = await pinChatMessage(msgId, slug);
      // Message already posted — ack pin only.
      return pinOk ? ok("Pinned.", "Sabitlendi.") : fail("Posted but couldn't pin it.", "Yazdım ama sabitleyemedim.");
    }
    case "unpin": {
      const home = await getMyChannel();
      const slug = resolveSayChannel(order, original, homeSlug) || home.slug.toLowerCase();
      const unpinOk = await unpinChatMessage(slug);
      return unpinOk ? ok("Unpinned.", "Sabitleme kalktı.") : fail("Couldn't unpin.", "Sabitleme kaldırılamadı.");
    }
    case "discord_voice": {
      const modeRaw = (order.mode || "verbatim").toLowerCase();
      const result = await runDiscordVoiceBridge(
        {
          join: modeRaw !== "leave",
          leave: modeRaw === "leave",
          say: modeRaw === "riff" || modeRaw === "join" || modeRaw === "leave" ? undefined : order.text?.trim(),
          topic: modeRaw === "riff" ? order.text?.trim() : undefined,
          mode:
            modeRaw === "leave" || modeRaw === "join"
              ? "join_only"
              : modeRaw === "riff"
                ? "riff"
                : modeRaw === "repeat"
                  ? "repeat"
                  : "verbatim",
          lang,
        },
        { who: KING_NAME, userKey: KING_ID },
      );
      if (!result.ok) return fail(result.error, result.error);
      return modeRaw === "verbatim" || modeRaw === "riff" || modeRaw === "repeat"
        ? null
        : ok(result.detail, result.detail);
    }
    case "emote": {
      const named = (order.text || "").trim();
      const mood =
        (order.mode as EmoteMood | undefined) ||
        detectEmoteMoodRequest(original) ||
        detectEmoteMoodRequest(named);
      let line: string | null = null;

      if (named) {
        const hit = await findKickEmote(named);
        if (hit) line = formatKickEmote(hit);
        else if (!mood) line = await spamKickEmote(named, 1);
      }
      if (!line && mood) {
        const burst = /\b(?:spam|spaml|ardarda|back\s*to\s*back|üstüste|ustuste|go\s+|get\s+)/i.test(original)
          ? 3 + Math.floor(Math.random() * 3)
          : 2 + Math.floor(Math.random() * 2);
        line = await formatMoodEmoteBurst(mood, burst);
      }
      if (!line) {
        const rnd = await pickRandomKickEmote();
        line = rnd ? formatKickEmote(rnd) : null;
      }
      if (!line) return fail("No emotes loaded.", "Emote listesi yok.");
      await say(line, undefined, broadcasterUserId);
      return null;
    }
    case "ban":
    case "timeout": {
      const who = (order.text || "").replace(/^@/, "").trim() || extractBanTarget(original);
      if (!who) return fail("Ban/timeout whom?", "Kimi ban/timeout?");
      const userId = await resolveKickUserId(who, broadcasterUserId);
      if (!userId) return fail(`Couldn't find ${who}.`, `${who} bulunamadı.`);
      if (userId === KING_ID) return fail("I won't ban the king.", "Kralı banlamam.");
      const mins =
        order.action === "ban"
          ? null
          : Math.max(1, Math.ceil((order.seconds && order.seconds > 0 ? order.seconds : 300) / 60));
      await timeoutOrBan(broadcasterUserId, userId, mins, order.action === "ban" ? "king ban" : "king timeout");
      return order.action === "ban"
        ? ok(`Banned ${who}.`, `${who} banlandı.`)
        : ok(`Timed out ${who}.`, `${who} timeout yedi.`);
    }
    default:
      return undefined;
  }
}

function looksLikeEmoteDropOrder(content: string): boolean {
  const f = fold(content);
  if (isEmoteOrder(content)) return false; // emote-only mode
  const mood = detectEmoteMoodRequest(content);
  // "go laugh" / "get angry" / "kızgın emoji at"
  if (mood && /(?:emoji|emote|go\s+|get\s+|post|send|at|atsana|gonder|gönder|bas|spam)/.test(f)) {
    return true;
  }
  if (!/(?:emoji|emote)/.test(f)) return false;
  return /(?:at|atsana|atabilir|gonder|gönder|drop|send|yaz|koysana|bas|go\s+)/.test(f);
}

function extractNamedEmote(content: string): string {
  const m =
    content.match(/\b(?:emote|emoji)\s+([A-Za-z0-9_]{2,32})\b/i) ||
    content.match(/\b([A-Za-z0-9_]{2,32})\s+(?:emote|emoji)\b/i);
  return m?.[1]?.trim() || "";
}

function extractBanTarget(content: string): string {
  const m =
    content.match(/@([A-Za-z0-9_]+)/)?.[1] ||
    content.match(/\b(?:ban|timeout|sustur|at)\s+(?:this\s+guy\s+)?@?([A-Za-z0-9_]{3,25})/i)?.[1];
  return m?.trim() || "";
}

async function resolveKickUserId(usernameOrSlug: string, broadcasterUserId: number): Promise<number | null> {
  const needle = usernameOrSlug.replace(/^@/, "").toLowerCase();
  if (!needle) return null;
  for (const line of lastChatLines(broadcasterUserId, 40)) {
    if (line.user?.toLowerCase() === needle && line.userId) return line.userId;
  }
  try {
    const pub = await lookupPublicChannel(needle);
    if (pub?.userId) return pub.userId;
  } catch {
    /* ignore */
  }
  return null;
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
