import { ChannelType, type Message, type VoiceBasedChannel } from "discord.js";
import { botFail, botOk, botThink, botWarn } from "../bot/activityLog.js";
import { generateLine, generateRaw, rememberExchange } from "../bot/ai.js";
import { fold } from "../bot/slang.js";
import type { ChatLang } from "../bot/lang.js";
import { detectLang } from "../bot/lang.js";
import { joinVoice, leaveVoice, parseSpeakDirective, speakInGuild, isInVoiceGuild } from "./voice.js";
import { getLastBotLine } from "./speechMemory.js";

/** verbatim = exact words; riff = invent take; repeat = replay; count = speak a number range */
export type DiscordVoiceAction = {
  join: boolean;
  leave: boolean;
  mode: "none" | "verbatim" | "riff" | "repeat" | "count";
  /** Exact words when mode=verbatim */
  say?: string;
  /** Situation/topic when mode=riff — bot invents what to say */
  topic?: string;
  /** Count range (Turkish “say” = count) */
  countFrom?: number;
  countTo?: number;
  lang?: "tr" | "en" | "other";
  voice?: string;
  forceVoice?: boolean;
};

export type DiscordVoiceOrderResult =
  | { handled: false }
  | { handled: true; spoke: boolean; joined: boolean; left: boolean; error?: string };

const VOICE_ORDER_HINT =
  /(?:katil|gir\b|join|baglan|buraya|ses(?:e)?\s+gir|(?:ses\s*)?(?:kanal|channel|call|vc).{0,24}(?:katil|gir|join|baglan)|(?:cik|ayril)\b|leave|disconnect|sesli|dusunce|düşünce|fikrini|hakkinda|hakkında|say\s+(?:this|that)|şunu\s+söyle|sunu\s+soyle|bir\s+sey\s+de|bir\s+şey\s+de|tekrar|ayni\s+sey|aynı\s+şey|dile\s+getir|say\s+it\s+again|repeat|\dkadar\s*say|kadar\s*say|count\s+from|\d+\s*(?:den|dan)\s*\d+)/i;

/** Cheap prefilter: worth trying to parse a Discord voice join/leave/speak order? */
export function shouldTryDiscordVoiceOrder(content: string): boolean {
  const t = content.replace(/\s+/g, " ").trim();
  if (!t || t.length > 500) return false;
  const f = fold(t);
  if (isRepeatRequest(t)) return true;
  if (parseCountRange(t)) return true;
  if (VOICE_ORDER_HINT.test(t) || VOICE_ORDER_HINT.test(f)) return true;
  if (/(?:kanala|kanalina|bu\s+kanal|buraya|this\s+channel|voice\s*channel)/.test(f) && /(?:katil|gir|join|baglan)/.test(f)) {
    return true;
  }
  if (/\bbana\b/.test(f) && /\bde\b/.test(f) && /(?:katil|join|sesli|kanal|channel|call|gir)/.test(f)) return true;
  return false;
}

/** “1'den 100'e kadar say” / “count from 1 to 100” — Turkish say = count. */
export function parseCountRange(content: string): { from: number; to: number } | null {
  const f = fold(content)
    .replace(/['']/g, "")
    .replace(/(\d+)\s*e\s+kadar/g, "$1 e kadar");
  const patterns = [
    /(\d+)\s*(?:den|dan)\s*(\d+)\s*(?:['']?[ea]|ye|ya)?\s*kadar\s*say/,
    /(\d+)\s*(?:den|dan)\s*(\d+)\s*e\s*kadar\s*say/,
    /say\s+(\d+)\s*(?:den|dan)?\s*(?:to\s+)?(\d+)/,
    /count\s+(?:from\s+)?(\d+)\s*(?:to|-)\s*(\d+)/,
    /(\d+)\s*(?:to|-|ile)\s*(\d+)\s*(?:ye?\s*)?(?:kadar\s*)?(?:say|count)/,
    /(\d+)\s*[-–]\s*(\d+)\s*(?:ye?\s*)?kadar\s*say/,
  ];
  for (const re of patterns) {
    const m = f.match(re);
    if (!m?.[1] || !m[2]) continue;
    let from = Number(m[1]);
    let to = Number(m[2]);
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
    from = Math.floor(from);
    to = Math.floor(to);
    if (from === to) continue;
    // Cap range size
    if (Math.abs(to - from) > 100) {
      if (to > from) to = from + 100;
      else to = from - 100;
    }
    if (from < -999 || to > 9999 || from > 9999 || to < -999) continue;
    return { from, to };
  }
  return null;
}

export function buildCountSpeech(from: number, to: number, lang: ChatLang): string {
  const step = from <= to ? 1 : -1;
  const parts: string[] = [];
  for (let n = from; step > 0 ? n <= to : n >= to; n += step) {
    parts.push(String(n));
    if (parts.length > 101) break;
  }
  // Slight pause between numbers for TTS
  return parts.join(", ");
}

export function isRepeatRequest(content: string): boolean {
  const f = fold(content);
  if (/ayni\s+sey(?:i)?/.test(f)) return true;
  if (/bir\s+daha\s+(?:soyle|de|oku)/.test(f)) return true;
  if (/tekrar\s+(?:et|soyle|de|oku)/.test(f)) return true;
  if (/(?:sesli(?:de)?|az\s+once|biraz\s+once).{0,48}tekrar/.test(f)) return true;
  if (/soyledigin(?:i)?\s+tekrar/.test(f)) return true;
  if (/say\s+(?:it|that)\s+again/.test(f)) return true;
  if (/repeat\s+(?:that|it|what\s+you|yourself)/.test(f)) return true;
  if (/again\b/.test(f) && /(?:say|speak|soyle)\b/.test(f) && f.length < 80) return true;
  return false;
}

function wantsRiff(content: string): boolean {
  if (isRepeatRequest(content)) return false;
  const f = fold(content);
  return (
    /dusunce(?:lerini|lerin|ni|ler)?/.test(f) ||
    /fikr(?:ini|in|ini)\s+soyle/.test(f) ||
    /(?:konu\s+)?hakkindaki?/.test(f) ||
    /(?:your\s+)?thoughts|speak\s+your\s+mind|riff\s+on|comment\s+on/.test(f) ||
    /sesli\s+(?:olarak|bir\s+sekilde)/.test(f) ||
    /dile\s+getir/.test(f) ||
    /(?:git\s+)?bir\s+sey\s+(?:de|soyle)/.test(f) ||
    /(?:go\s+)?say\s+something/.test(f) ||
    /ne\s+dusun(?:uyorsun|ursun|celerin)/.test(f)
  );
}

/** Strip order fluff so the remaining text is the topic to riff on. */
function extractRiffTopic(content: string): string {
  const named = extractTopic(content);
  if (named) return named;
  const stripped = content
    .replace(/^.*?(?:gir|katıl|katil|join|bağlan|baglan)\s*(?:ve|and|sonra)?\s*/i, "")
    .replace(/sesli\s+(?:olarak|bir\s+şekilde|bir\s+sekilde)?\s*/gi, " ")
    .replace(/düşünce(?:lerini|lerin|ni)?\s*(neler)?\s*/gi, " ")
    .replace(/dile\s+getir/gi, " ")
    .replace(/senin\s+/gi, " ")
    .replace(/bu\s+konu\s+hakk[ıi]ndaki?\s*/gi, " ")
    .replace(/hakk[ıi]ndaki?\s*(düşünce(?:lerini|lerin|ni)?)?\s*/gi, " ")
    .replace(/[:：]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (stripped.length >= 8 ? stripped : content).slice(0, 400);
}

function extractTopic(content: string): string | undefined {
  const patterns = [
    /(?:bu\s+)?konu\s+hakk[ıi]nda\s*[:：]\s*(.+)$/i,
    /hakk[ıi]nda\s*[:：]\s*(.+)$/i,
    /düşünce(?:lerini|ni)?\s+söyle(?:\s+bu\s+konu\s+hakk[ıi]nda)?\s*[:：]\s*(.+)$/i,
    /(?:thoughts?|take|comment)\s+(?:on|about)\s*[:：]?\s*(.+)$/i,
    /about\s*[:：]\s*(.+)$/i,
    /sesli\s+olarak\s+düşünce(?:lerini|ni)?\s+söyle\s+bu\s+konu\s+hakk[ıi]nda\s*[:：]?\s*(.+)$/i,
  ];
  for (const re of patterns) {
    const m = content.match(re);
    const topic = m?.[1]?.replace(/\s+/g, " ").trim();
    if (topic && topic.length >= 3) return topic.slice(0, 400);
  }
  // "… söyle … : topic" loose fallback
  const colon = content.match(/[:：]\s*(.+)$/);
  if (colon?.[1] && wantsRiff(content)) {
    const topic = colon[1].replace(/\s+/g, " ").trim();
    if (topic.length >= 8) return topic.slice(0, 400);
  }
  return undefined;
}

function extractVerbatimPhrase(content: string): string | undefined {
  // Riff requests must not steal the topic as a "say" line
  if (wantsRiff(content) && !/\bsay\s+this\b/i.test(content) && !/şunu\s+söyle/i.test(content)) {
    return undefined;
  }

  const dir = parseSpeakDirective(content);
  if (dir.phrase && dir.directSay && !wantsRiff(content)) return dir.phrase;
  if (dir.phrase && /\bsay\s+this\b|şunu\s+söyle/i.test(content)) return dir.phrase;

  const patterns = [
    /\bbana\s+["“”']?([^"“”'\n]{1,80}?)["“”']?\s+de(?:\b|[.!?…]|$)/i,
    /\b(?:bana\s+)?["“”]([^"“”]{1,120})["“”]\s*(?:de|soyle|söyle|der\s+misin)/i,
    /\bsay\s+this\s*[:：]\s*["“”']?(.+?)["“”']?(?:\s+in\s+\w+)?$/i,
    /\b(?:söyle|soyle)\s*[:：]\s*["“”']([^"“”']{1,120})["“”']/i,
  ];
  for (const re of patterns) {
    const m = content.match(re);
    const phrase = m?.[1]?.replace(/\s+/g, " ").trim();
    // Verbatim lines are short; long blobs are topics
    if (phrase && phrase.length <= 80 && !/hakk[ıi]nda|düşünce|wuwa|oynam/i.test(phrase)) {
      return phrase;
    }
    if (phrase && phrase.length <= 40) return phrase;
  }
  return undefined;
}

function detectJoin(content: string): boolean {
  const f = fold(content);
  return (
    /(?:(?:bu|su|o)\s+)?kanal(?:a|ina)?\s+(?:katil|gir)/.test(f) ||
    /(?:ses(?:e)?\s+)?(?:kanal|channel|call|vc)(?:a|e|ina)?\s+(?:katil|gir|join|baglan)/.test(f) ||
    /\b(?:join|baglan)\b/.test(f) ||
    /kanala\s+(?:katil|gir)|\bkatil\b/.test(f) ||
    /(?:ses(?:e)?|call(?:a|e)?)\s+gir/.test(f) ||
    /\bburaya\s+(?:katil|gir|join|baglan)/.test(f) ||
    (/\bburaya\b/.test(f) && /(?:katil|gir|join|baglan)/.test(f))
  );
}

function detectLeave(content: string): boolean {
  const f = fold(content);
  return (
    /(?:ses(?:ten|den)?\s+)?(?:cik|ayril)/.test(f) ||
    /\b(?:leave|disconnect)\b/.test(f) ||
    /kanaldan\s+cik|call(?:dan|den)\s+cik/.test(f)
  );
}

function heuristicOrder(content: string): DiscordVoiceAction | null {
  const dir = parseSpeakDirective(content);
  if (isRepeatRequest(content)) {
    return {
      join: detectJoin(content) && !detectLeave(content),
      leave: detectLeave(content),
      mode: "repeat",
      lang: dir.lang,
      voice: dir.voice,
      forceVoice: dir.forceVoice,
    };
  }

  const count = parseCountRange(content);
  if (count) {
    return {
      join: detectJoin(content) && !detectLeave(content),
      leave: detectLeave(content),
      mode: "count",
      countFrom: count.from,
      countTo: count.to,
      lang: dir.lang ?? "tr",
      voice: dir.voice,
      forceVoice: dir.forceVoice,
    };
  }

  const join = detectJoin(content) && !detectLeave(content);
  const leave = detectLeave(content);
  const riff = wantsRiff(content);
  const topic = riff ? extractRiffTopic(content) : undefined;
  const say = riff ? undefined : extractVerbatimPhrase(content);

  let mode: DiscordVoiceAction["mode"] = "none";
  if (riff) mode = "riff";
  else if (say) mode = "verbatim";
  else if (dir.wantsSpeak && dir.phrase) mode = "verbatim";

  if (!join && !leave && mode === "none") return null;

  return {
    join,
    leave,
    mode,
    say: mode === "verbatim" ? say || dir.phrase : undefined,
    topic: mode === "riff" ? topic : undefined,
    lang: dir.lang,
    voice: dir.voice,
    forceVoice: dir.forceVoice,
  };
}

async function aiOrder(content: string): Promise<DiscordVoiceAction | null> {
  const raw = await generateRaw(
    [
      "Parse Discord VOICE orders for CamelBot. Reply ONE JSON object only. No markdown.",
      '{"join":false,"leave":false,"mode":"none|verbatim|riff|repeat|count","say":"","topic":"","countFrom":null,"countTo":null,"lang":"tr|en|"}',
      "",
      "join=true: join their voice channel (katıl, gir, join, buraya katıl).",
      "leave=true: leave voice.",
      "",
      "mode=count: they want the bot to COUNT numbers out loud.",
      '  Turkish "say" often means COUNT (e.g. "1den 100e kadar say", "buraya katıl ve 1 den 100 e kadar say").',
      "  English: count from 1 to 100.",
      "  → set countFrom and countTo. say=\"\" topic=\"\".",
      "mode=repeat: repeat last spoken line.",
      "mode=verbatim: EXACT words to recite (bana kralım de).",
      "mode=riff: invent thoughts ABOUT a topic.",
      "mode=none: join/leave only.",
      "",
      'Example: "buraya katıl ve 1den 100 e kadar say" → {"join":true,"leave":false,"mode":"count","countFrom":1,"countTo":100,"lang":"tr"}',
      "",
      `Message: ${content}`,
    ].join("\n"),
    "Extract Discord voice intents. Turkish say=count when with numbers. JSON only.",
    { standalone: true, timeoutMs: 10_000, tokens: 200, temperature: 0.1 },
  );
  if (!raw) return null;
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      join?: boolean;
      leave?: boolean;
      mode?: string;
      say?: string;
      topic?: string;
      countFrom?: number | null;
      countTo?: number | null;
      lang?: string;
    };
    const join = Boolean(parsed.join);
    const leave = Boolean(parsed.leave);
    let mode: DiscordVoiceAction["mode"] =
      parsed.mode === "verbatim" ||
      parsed.mode === "riff" ||
      parsed.mode === "repeat" ||
      parsed.mode === "count" ||
      parsed.mode === "none"
        ? parsed.mode
        : "none";
    if (isRepeatRequest(content)) mode = "repeat";
    const counted = parseCountRange(content);
    if (counted) mode = "count";
    const say = String(parsed.say ?? "").trim();
    const topic = String(parsed.topic ?? "").trim();
    const countFrom = counted?.from ?? (typeof parsed.countFrom === "number" ? parsed.countFrom : undefined);
    const countTo = counted?.to ?? (typeof parsed.countTo === "number" ? parsed.countTo : undefined);
    if (mode === "none" && say) mode = "verbatim";
    if (mode === "none" && topic) mode = "riff";
    if (mode === "verbatim" && topic && !say) mode = "riff";
    if (mode === "riff" && say && !topic) {
      return { join, leave, mode: "riff", topic: say, lang: parsed.lang === "en" ? "en" : "tr" };
    }
    if (!join && !leave && mode === "none") return null;
    const lang = parsed.lang === "en" ? "en" : parsed.lang === "tr" ? "tr" : undefined;
    return {
      join,
      leave,
      mode,
      say: mode === "verbatim" ? say || undefined : undefined,
      topic: mode === "riff" ? topic || undefined : undefined,
      countFrom: mode === "count" ? countFrom : undefined,
      countTo: mode === "count" ? countTo : undefined,
      lang,
    };
  } catch {
    return null;
  }
}

export async function interpretDiscordVoiceOrder(content: string): Promise<DiscordVoiceAction | null> {
  if (isRepeatRequest(content)) {
    const dir = parseSpeakDirective(content);
    return {
      join: detectJoin(content) && !detectLeave(content),
      leave: detectLeave(content),
      mode: "repeat",
      lang: dir.lang,
      voice: dir.voice,
      forceVoice: dir.forceVoice,
    };
  }

  const counted = parseCountRange(content);
  if (counted) {
    const dir = parseSpeakDirective(content);
    return {
      join: detectJoin(content) && !detectLeave(content),
      leave: detectLeave(content),
      mode: "count",
      countFrom: counted.from,
      countTo: counted.to,
      lang: dir.lang ?? "tr",
      voice: dir.voice,
      forceVoice: dir.forceVoice,
    };
  }

  const fast = heuristicOrder(content);

  // Clear riff / verbatim / count from heuristics
  if (fast && (fast.mode === "riff" || fast.mode === "verbatim" || fast.mode === "repeat" || fast.mode === "count")) {
    if (fast.mode === "riff" && !fast.topic) {
      fast.topic = extractRiffTopic(content);
    }
    return fast;
  }

  if (fast && (fast.join || fast.leave) && fast.mode === "none") {
    // Join/leave only, or join with unclear speak intent → ask AI
    if (/\b(?:ve|and|sonra|sesli|söyle|soyle|de\b|düşünce|dile)/i.test(content)) {
      botThink("voice", "Understanding Discord voice order…");
      try {
        const ai = await aiOrder(content);
        if (ai) {
          const dir = parseSpeakDirective(content);
          const mode =
            ai.mode !== "none" ? ai.mode : wantsRiff(content) ? "riff" : ai.say ? "verbatim" : "none";
          return {
            join: ai.join || fast.join,
            leave: ai.leave || fast.leave,
            mode,
            say: mode === "verbatim" ? ai.say : undefined,
            topic: mode === "riff" ? ai.topic || extractRiffTopic(content) : undefined,
            lang: dir.lang ?? ai.lang,
            voice: dir.voice,
            forceVoice: dir.forceVoice,
          };
        }
      } catch (err) {
        botWarn("voice", `Voice-order AI fail: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return fast;
  }

  botThink("voice", "Understanding Discord voice order…");
  try {
    const ai = await aiOrder(content);
    if (ai) {
      const dir = parseSpeakDirective(content);
      if (ai.mode === "riff" && !ai.topic) ai.topic = extractRiffTopic(content);
      return {
        ...ai,
        voice: dir.voice ?? ai.voice,
        forceVoice: dir.forceVoice || ai.forceVoice,
        lang: dir.lang ?? ai.lang,
      };
    }
  } catch (err) {
    botWarn("voice", `Voice-order AI fail: ${err instanceof Error ? err.message : String(err)}`);
  }
  return fast;
}

function resolveVoiceChannel(message: Message): VoiceBasedChannel | null {
  for (const ch of message.mentions.channels.values()) {
    if (ch.type === ChannelType.GuildVoice || ch.type === ChannelType.GuildStageVoice) {
      return ch as VoiceBasedChannel;
    }
  }
  const memberChannel = message.member?.voice.channel;
  if (
    memberChannel &&
    (memberChannel.type === ChannelType.GuildVoice || memberChannel.type === ChannelType.GuildStageVoice)
  ) {
    return memberChannel;
  }
  return null;
}

/** Prefer author's VC; if they said "my channel" / "olduğum kanal", still use their presence (async). */
export async function resolveVoiceChannelAsync(message: Message): Promise<VoiceBasedChannel | null> {
  const quick = resolveVoiceChannel(message);
  if (quick) return quick;
  const { findMemberVoiceChannel } = await import("./bridge.js");
  const spot = await findMemberVoiceChannel(message.author.id, message.guildId ?? undefined);
  return spot?.channel ?? null;
}

/** Invent a short spoken take about a topic — never echo the order/topic verbatim. */
async function inventSpokenTake(
  topic: string,
  opts: { lang: ChatLang; who: string; fromKing?: boolean },
): Promise<string | null> {
  const langLine =
    opts.lang === "en"
      ? "Speak ONLY in English."
      : opts.lang === "tr"
        ? "Speak ONLY in Turkish — every word."
        : "Match the topic language (Turkish or English).";

  botThink("voice", `Inventing spoken take (${topic.slice(0, 80)})`);
  const text = await generateLine(
    [
      "You are CamelBot. The user ordered you to join Discord voice and SPEAK your thoughts about a topic.",
      "Write ONLY the words you will say out loud (TTS). 1–3 short sentences.",
      "This is YOUR opinion / roast / reaction about the situation — invent it.",
      "Do NOT repeat or paraphrase the user's order.",
      "Do NOT read the topic back word-for-word. React to it like a chat friend.",
      "No meta ('düşüncelerim', 'şunu söyleyeyim', 'I'll say'). No *actions*. No quotes of the whole topic.",
      langLine,
      opts.fromKing ? "The order comes from mcvckaharamamm — still give a real take, not empty flattery." : "",
      `Topic / situation: ${topic}`,
      `Asked by: ${opts.who}`,
    ]
      .filter(Boolean)
      .join("\n"),
    { timeoutMs: 12_000 },
  );
  return text?.replace(/\*[^*]+\*/g, " ").replace(/\s+/g, " ").trim() || null;
}

/**
 * Execute join / leave / speak orders from natural language Discord chat.
 * Returns handled=true when this was a voice order (even if it failed).
 */
export async function tryDiscordVoiceOrder(
  message: Message,
  opts: { lang: ChatLang; userKey: number; who: string; fromKing?: boolean },
): Promise<DiscordVoiceOrderResult> {
  const content = message.content.trim();
  if (!shouldTryDiscordVoiceOrder(content)) return { handled: false };
  if (!message.guildId || !message.guild) return { handled: false };

  const action = await interpretDiscordVoiceOrder(content);
  if (!action || (!action.join && !action.leave && action.mode === "none")) {
    return { handled: false };
  }
  if (!action.join && !action.leave && action.mode === "verbatim" && !action.say) {
    return { handled: false };
  }
  if (!action.join && !action.leave && action.mode === "riff") {
    if (!action.topic) action.topic = extractRiffTopic(content);
    if (!action.topic) return { handled: false };
  }
  if (
    !action.join &&
    !action.leave &&
    action.mode === "count" &&
    (action.countFrom == null || action.countTo == null)
  ) {
    return { handled: false };
  }

  botThink(
    "voice",
    `Order: join=${action.join} leave=${action.leave} mode=${action.mode} say=${(action.say ?? "").slice(0, 30)} topic=${(action.topic ?? "").slice(0, 40)} count=${action.countFrom ?? ""}-${action.countTo ?? ""}`,
  );

  let joined = false;
  let left = false;
  let spoke = false;
  const guildId = message.guildId;

  try {
    if (action.leave) {
      await leaveVoice(guildId);
      left = true;
      botOk("voice", "Left voice (order)");
    }

    if (action.join) {
      const channel = await resolveVoiceChannelAsync(message);
      if (!channel) {
        return {
          handled: true,
          spoke: false,
          joined: false,
          left,
          error:
            opts.lang === "en"
              ? "Join a voice channel first (or mention a voice channel), then tell me to join."
              : "Önce bir ses kanalına gir (veya ses kanalını etiketle), sonra katıl demen yeterli.",
        };
      }
      await joinVoice(message.client, channel, message.channelId);
      joined = true;
      botOk("voice", `Joined ${channel.name} (order)`);
    }

    const needsSpeak =
      action.mode === "verbatim" ||
      action.mode === "riff" ||
      action.mode === "repeat" ||
      action.mode === "count";
    if (needsSpeak) {
      if (!isInVoiceGuild(guildId) && !joined) {
        const channel = await resolveVoiceChannelAsync(message);
        if (channel) {
          await joinVoice(message.client, channel, message.channelId);
          joined = true;
        }
      }
      if (!isInVoiceGuild(guildId)) {
        return {
          handled: true,
          spoke: false,
          joined,
          left,
          error:
            opts.lang === "en"
              ? "I'm not in a voice channel. Join one and tell me to join, or say it after I'm in the call."
              : "Ses kanalında değilim. Önce katıl demen lazım, ya da zaten çağrıdaysam tekrar söyle.",
        };
      }

      let line: string | null = null;
      if (action.mode === "count" && action.countFrom != null && action.countTo != null) {
        line = buildCountSpeech(action.countFrom, action.countTo, action.lang ?? opts.lang);
      } else if (action.mode === "repeat") {
        line = getLastBotLine(guildId, opts.userKey) ?? null;
        if (!line) {
          return {
            handled: true,
            spoke: false,
            joined,
            left,
            error:
              opts.lang === "en"
                ? "I don't remember what I said last — ask me something first."
                : "Az önce ne dediğimi hatırlamıyorum — önce bir şey söylemem lazım.",
          };
        }
      } else if (action.mode === "verbatim" && action.say) {
        line = action.say;
      } else if (action.mode === "riff") {
        const topic = action.topic || extractRiffTopic(content);
        line = await inventSpokenTake(topic, {
          lang: action.lang ?? opts.lang,
          who: opts.who,
          fromKing: opts.fromKing,
        });
        if (!line) {
          return {
            handled: true,
            spoke: false,
            joined,
            left,
            error: opts.lang === "en" ? "Couldn't invent a take to speak." : "Söylenecek bir şey uyduramadım.",
          };
        }
      }

      if (line) {
        const speakLang = action.lang ?? detectLang(line, opts.userKey);
        const spoken = await speakInGuild(guildId, line, {
          lang: speakLang,
          voice: action.voice,
          forceVoice: action.forceVoice,
          userKey: opts.userKey,
        });
        if (!spoken.ok) {
          return { handled: true, spoke: false, joined, left, error: spoken.error };
        }
        spoke = true;
        rememberExchange(opts.userKey, content, `[voice] ${line}`);
        botOk("voice", `Spoke (${action.mode}): ${line.slice(0, 80)}`);
      }
    }

    return { handled: true, spoke, joined, left };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    botFail("voice", `Order fail: ${msg}`);
    return { handled: true, spoke, joined, left, error: msg };
  }
}
