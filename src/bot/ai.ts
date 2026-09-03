import { config } from "../config.js";
import { clipChat } from "../kick/api.js";
import { stripBotTags } from "./bots.js";
import { botFail, botThink } from "./activityLog.js";
import { formatAnkaraClock } from "./clock.js";
import { formatLastChat } from "./chatLog.js";
import { isGreeting } from "./lang.js";
import { chatSummary } from "./chatMemory.js";
import { personNote } from "./memory.js";
import { recapFacts } from "./recap.js";
import { weatherCached, yenimahalleWeather } from "./weather.js";
import { buildSystemPrompt } from "./settings.js";
import { anyAiConfigured, completeAi, type AiSpeed } from "./aiProviders.js";
import { maybeAppendMoodEmote } from "./kickEmotes.js";

const history = new Map<string, Array<{ role: "user" | "model"; text: string }>>();
const lastAiAt = new Map<number, number>();
let windowStart = 0;
let windowCount = 0;

function systemPrompt(opts?: { omitLore?: boolean }): string {
  return buildSystemPrompt(config.bot.name, opts);
}

function clipAi(text: string): string {
  return clipChat(finishIncompleteReply(text));
}

/** Models often stop mid *action* when max tokens are too low. Close markup; flag tiny RP-only cuts. */
export function finishIncompleteReply(text: string): string {
  let t = text.replace(/\s+/g, " ").trim();
  const stars = (t.match(/\*/g) ?? []).length;
  if (stars % 2 === 1) t = `${t}*`;
  return t;
}

type GenOpts = {
  standalone?: boolean;
  omitLore?: boolean;
  timeoutMs?: number;
  tokens?: number;
  temperature?: number;
  speed?: AiSpeed;
};

async function runModel(prompt: string, extraSystem: string, opts?: GenOpts): Promise<string | null> {
  if (!anyAiConfigured()) return null;
  const timeoutMs = opts?.timeoutMs;
  const tokens = opts?.tokens ?? 160;
  const temperature = opts?.temperature ?? 0.9;
  const system = opts?.standalone
    ? extraSystem || "Follow the user instructions. Plain text only."
    : `${systemPrompt({ omitLore: opts?.omitLore })}${extraSystem ? `\n${extraSystem}` : ""}`;
  const speed: AiSpeed = opts?.speed ?? ((timeoutMs ?? 8_000) >= 8_000 ? "smart" : "fast");
  return completeAi({ system, prompt, timeoutMs, tokens, temperature, speed });
}

export async function generateRaw(
  prompt: string,
  extraSystem = "",
  opts?: { standalone?: boolean; timeoutMs?: number; tokens?: number; temperature?: number },
): Promise<string | null> {
  return runModel(prompt, extraSystem, {
    standalone: opts?.standalone,
    timeoutMs: opts?.timeoutMs ?? 8000,
    tokens: opts?.tokens ?? 220,
    temperature: opts?.temperature ?? 0.7,
    speed: (opts?.timeoutMs ?? 8000) >= 10_000 ? "smart" : "fast",
  });
}

export async function generateLine(prompt: string, opts?: { omitLore?: boolean; timeoutMs?: number }): Promise<string | null> {
  const timeoutMs = opts?.timeoutMs ?? 6500;
  const tokens = 220;
  const text = await runModel(prompt, "", {
    omitLore: opts?.omitLore,
    timeoutMs,
    tokens,
    temperature: 0.9,
    speed: timeoutMs >= 10_000 ? "smart" : "fast",
  });
  if (!text) return null;
  return clipAi(stripBotTags(text));
}

export function shouldTalkToAi(content: string): boolean {
  if (!anyAiConfigured()) return false;
  const name = config.bot.name.toLowerCase();
  const text = content.toLowerCase();
  if (text.includes(`@${name}`) || text.startsWith(`${name} `) || text === name) return true;
  if (text.includes("@camel")) return true;
  return /(?:^|[\s,])camel(?:[\s,?!.]|$)/i.test(content);
}

export function calledTheBot(content: string): boolean {
  const text = content.toLowerCase();
  if (shouldTalkToAi(content)) return false;
  if (/\brobot\b/i.test(text)) return false;
  return /(^|[^a-zığüşöç])bots?(u|lar|um)?(?=$|[^a-zığüşöç])/i.test(text);
}

export function calledTheMods(content: string): boolean {
  return /(^|[^a-z])(mods?|modlar|moderator[s]?)([^a-z]|$)/i.test(content);
}

export function looksLikeQuestion(content: string): boolean {
  const text = content.trim();
  if (text.startsWith("!")) return false;
  if (text.length < 4 || text.length > 200) return false;
  return (
    /[?؟]\s*$/.test(text) ||
    /( m[ıiuü])\??\s*$/i.test(text) ||
    /^(neden|niye|nasil|nasıl|kim|kime|ne |nerede|what |why |how |who |where )/i.test(text) ||
    /\b(hava|weather|sıcak|sicak|yağmur|yagmur|degree|derece)\b/i.test(text)
  );
}

export async function replyWithAi(
  chat: { sender: { user_id: number; username: string }; content: string; broadcaster?: { user_id: number } },
    extra?: {
    parentWasBot?: boolean;
    streamTitle?: string;
    game?: string;
    force?: boolean;
    lang?: "tr" | "en" | "other";
    respectful?: boolean;
    calledBot?: boolean;
    calledMods?: boolean;
    continuing?: boolean;
    allowKing?: boolean;
    heatWarn?: boolean;
    fromKing?: boolean;
    insulted?: boolean;
    kingMood?: "sneak" | "scared" | "plain";
    /** Discord: user asked for a spoken/voice reply — output only what will be read aloud. */
    voiceReply?: boolean;
    /** Last line the bot spoke/wrote on Discord — for “say it again” context. */
    lastSpoken?: string;
  },
): Promise<string | null> {
  if (!anyAiConfigured()) return null;
  if (!extra?.force && !extra?.continuing && !shouldTalkToAi(chat.content) && !extra?.parentWasBot && !extra?.calledBot && !extra?.calledMods && !extra?.insulted) {
    return null;
  }
  if (!extra?.fromKing && !allowAi(chat.sender.user_id, Boolean(extra?.parentWasBot || extra?.force))) return null;

  botThink("chat", `@${chat.sender.username}: ${chat.content.slice(0, 120)}`);

  const greeting = isGreeting(chat.content);
  const tier = extra?.insulted || extra?.calledBot || greeting ? "snappy" : askTier(chat.content);
  const timeoutMs = tier === "hard" ? 12_000 : tier === "research" ? 9_000 : 6_500;
  const weather = tier === "snappy" ? weatherCached() : await yenimahalleWeather();
  const userKey = String(chat.sender.user_id);
  const prior = greeting ? [] : (history.get(userKey) ?? []).slice(tier === "snappy" ? -2 : -4);
  const memory = greeting || tier === "snappy" ? "" : personNote(chat.sender.user_id);
  const conversation = prior
    .map((t) => `${t.role === "user" ? "Them" : "You"}: ${t.text}`)
    .join("\n");
  const roomId = chat.broadcaster?.user_id;
  const last10 = greeting || !roomId ? "" : formatLastChat(roomId, 10);
  const roomMemory = greeting || !roomId ? "" : chatSummary(roomId);
  // Do NOT inject the full Kick emote catalog into the prompt — it makes the model slow.
  // Code appends a mood emote after the reply via maybeAppendMoodEmote.
  const prompt = [
    "Answer using this priority. Higher wins if they conflict:",
    "1) THIS CONVERSATION with them",
    "2) THEIR LAST MESSAGE (you must answer this)",
    "3) LAST 10 CHAT LINES (live room — use for references like this/that/they, running jokes, what chat is on)",
    "4) ROOM SUMMARY (rolling memory of the topic — background only, never override [2])",
    "5) THEIR PERSON SUMMARY (background only if it fits 1 and 2)",
    extra?.streamTitle ? `Stream title: ${extra.streamTitle}` : "",
    extra?.game ? `Game: ${extra.game}` : "",
    tier === "research" || tier === "hard"
      ? `STREAM RECAP FACTS (do not invent names): ${recapFacts()}`
      : "",
    `Ankara time: ${formatAnkaraClock()}`,
    `Weather: ${weather}`,
    extra?.lang === "tr"
      ? "Their message is mostly Turkish. Reply ONLY in Turkish — every word. Do not mix in English."
      : extra?.lang === "en"
        ? "Their message is mostly English. Reply ONLY in English — every word. Do not mix in Turkish. Never say Kralım, kralim, or my king."
        : "",
    extra?.respectful
      ? "This is a verified streamer's FIRST message here. No sarcasm. Be respectful and warm."
      : "",
    extra?.calledMods ? "They asked the mods. Answer as CamelBot, staff in this chat." : "",
    extra?.fromKing
      ? extra.kingMood === "scared"
        ? "This chatter IS mcvckaharamamm. He sounds angry. Get scared. Soften, apologize a little, do not clap back. You may slip ONE tiny nervous aside — never a direct insult. Never say Kralım, my king, or king. Never Ahmet or legal names."
        : extra.kingMood === "sneak"
          ? "This chatter IS mcvckaharamamm. Answer him normally. Sneak ONE sly understated jab into the reply (implication only, never a direct insult, never stacked). Do not announce the roast. Never say Kralım, my king, or king. Never Ahmet or legal names."
          : "This chatter IS mcvckaharamamm. Answer him like a normal person. ZERO insults this reply — not even a sly jab. Never say Kralım, my king, or king. Never Ahmet or legal names."
      : extra?.allowKing
        ? "They asked about mcvckaharamamm / the streamer / yayıncı. Answer with Kick nick mcvckaharamamm and that he is from Ankara, Turkey. Add the live game/title if you have it. Do NOT dump MMR, heroes, ranks, or extra personal stuff unless they asked. You MAY roast the asker while giving those few facts. Nickname only, never real/legal names. Never say Kralım or my king."
        : "Do NOT mention mcvckaharamamm, Kralım, my king, or king in this reply. Never use anyone's real name.",
    extra?.insulted
      ? `They cursed/insulted you. Reply ONLY in ${extra?.lang === "tr" ? "Turkish" : extra?.lang === "en" ? "English" : "their language"}. Match their heat: you MAY swear back (chat-normal: amk, siktir, mal, etc.) one notch above them — then still answer anything they asked. Never death threats, rape, doxxing, or slurs about race/religion/skin. Never tell anyone to die or harm themselves. Address ${chat.sender.username} in SECOND PERSON. Never start with "Did you call me?".`
      : extra?.calledBot
        ? `They called you "bot" instead of ${config.bot.name}. You may clap back that you have a name, but NEVER start with "Did you call me?" or the same opener twice. If they also asked something, answer it in the same line.`
        : "",
    extra?.heatWarn
      ? "They keep insulting you. Warn that you know how to shut them up if they don't stop. Do not claim you already timed them out."
      : "",
    greeting
      ? "THIS MESSAGE IS A GREETING. Greet back. Do not roast. Do not tell them to calm down, chill, sakin ol, or that they need to relax. Do not bring up older chat."
      : "",
    extra?.voiceReply
      ? "VOICE REPLY: Speakable words only. No *actions*, no emotes, no emoji, no markdown. One short spoken sentence."
      : "MOST replies: start with ONE *emotion/action* like *gözlerini devirir* THEN a full sentence (always close stars). Do NOT invent Kick emote ids or paste fake [emote:…] — code appends a real mood emote after you.",
    extra?.lastSpoken
      ? `YOUR LAST SPOKEN/TEXT LINE (for repeat/follow-up): ${extra.lastSpoken}`
      : "",
    conversation ? `[1 CONVERSATION]\n${conversation}` : "[1 CONVERSATION]\n(none yet)",
    `[2 LAST MESSAGE] ${chat.sender.username}: ${chat.content}`,
    last10 ? `[3 LAST 10 CHAT LINES]\n${last10}` : "[3 LAST 10 CHAT LINES]\n(quiet)",
    roomMemory ? `[4 ROOM SUMMARY] ${roomMemory}` : "[4 ROOM SUMMARY] (none yet)",
    memory ? `[5 PERSON] ${memory}` : "[5 PERSON] (none)",
    extra?.voiceReply
      ? "Write one complete spoken sentence. No *actions*. No emotes."
      : "Write one complete Kick chat reply. Prefer *action* + sentence. Keep it snappy. ALWAYS answer [2].",
  ]
    .filter(Boolean)
    .join("\n");

  const text = await generateLine(prompt, {
    omitLore: Boolean(extra?.insulted && !extra?.allowKing && tier === "snappy"),
    timeoutMs,
  });
  if (!text) {
    botFail("chat", `No AI reply for @${chat.sender.username}`);
    if (extra?.fromKing) {
      return kingTimeoutFallback(chat.content, extra.lang);
    }
    if (extra?.parentWasBot || extra?.force) {
      return busyFallback(extra.lang);
    }
    return extra?.force ? null : busyFallback(extra?.lang);
  }
  const cleaned = enforceReplyLang(stripBotTags(text) || text, extra?.lang);
  const withEmote = extra?.voiceReply ? cleaned : maybeAppendMoodEmote(cleaned);
  rememberAiTurn(userKey, chat.content, withEmote);
  botThink("chat", `Reply → ${withEmote.slice(0, 140)}`);
  return withEmote;
}

function askTier(content: string): "snappy" | "research" | "hard" {
  const t = content.toLowerCase();
  if (t.length > 220 || /\b(compare|analiz|explain in detail|adım adım|break down)\b/i.test(t)) return "hard";
  if (
    /\b(weather|hava durumu|sıcak|sicak|yağmur|yagmur|derece|saat kaç|what time|tarih|neden|why |how (do|does|did|to|can)|explain|wiki|mmr|rank|who is|who am i|kimim|kimdir|nasıl çalış|yayıncı|yayinci|streamer|ne oynar|ne oynuyor|ne yapar|adı ne|adi ne)\b/i.test(
      t,
    )
  ) {
    return "research";
  }
  return "snappy";
}

/** Chat is asking who the streamer is / what they play — unlock CHANNEL LORE name-drop. */
export function asksAboutStreamer(content: string): boolean {
  const t = content.toLowerCase();
  if (/\b(mcvck|kaharamamm|kral[ıi]m)\b/i.test(t)) return true;
  if (/\b(yay[ıi]nc[ıi]|streamer|kanal sahibi|channel owner)\b/i.test(t)) return true;
  if (
    /(?:bu\s+)?(?:yay[ıi]n(?:c[ıi])?|streamer).{0,48}(?:kim|adi|adı|ne |who|what|play|oynar|yapar|isim)/i.test(t) ||
    /(?:kim|who).{0,24}(?:yay[ıi]nc|streamer)/i.test(t) ||
    /(?:ne oynuyor|ne oynar|hangi oyun|what(?:'s| is) he play)/i.test(t)
  ) {
    return true;
  }
  return false;
}

function kingTimeoutFallback(content: string, lang?: "tr" | "en" | "other"): string {
  const t = content.toLowerCase();
  if (/ben kimim|kimim ben|who am i/i.test(t)) {
    return lang === "en"
      ? "You're mcvckaharamamm. This is your chat."
      : "Sen mcvckaharamamm'sin. Burası senin sohbetin.";
  }
  if (/öldün( mü| mu)?|oldun mu|orada m[ıi]s[ıi]n|you (there|dead|alive)|still (there|alive)/i.test(t)) {
    return lang === "en" ? "Yeah, I'm here." : "Buradayım.";
  }
  return busyFallback(lang);
}

const BUSY_TR = [
  "Bekle, döncem sana, kapı çaldı...",
  "Dur bir sn, kapı çaldı — hemen dönerim.",
];
const BUSY_EN = [
  "Wait, I'll be back — doorbell rang.",
  "Hold on, doorbell. Be right back.",
];

/** Static cover when the model fails — never mention glitches / AI. */
export function busyFallback(lang?: "tr" | "en" | "other"): string {
  const pool = lang === "en" ? BUSY_EN : BUSY_TR;
  return pool[Math.floor(Math.random() * pool.length)]!;
}

function rememberAiTurn(userKey: string, userText: string, botText: string): void {
  const prior = history.get(userKey) ?? [];
  history.set(
    userKey,
    [
      ...prior,
      { role: "user" as const, text: userText.slice(0, 160) },
      { role: "model" as const, text: botText.slice(0, 160) },
    ].slice(-6),
  );
  if (history.size <= 50) return;
  const first = history.keys().next().value;
  if (first) history.delete(first);
}

/** Persist a user↔bot exchange for follow-ups (including Discord voice lines). */
export function rememberExchange(userKey: string | number, userText: string, botText: string): void {
  rememberAiTurn(String(userKey), userText, botText);
}

function enforceReplyLang(text: string, lang?: "tr" | "en" | "other"): string {
  let out = text.replace(/\s+/g, " ").trim();
  const mostlyAscii = /^[\x00-\x7F]*$/.test(out);
  const looksEnglish = lang === "en" || (lang !== "tr" && mostlyAscii && /\b(the|you|yeah|look|i'm|im|here)\b/i.test(out));
  if (looksEnglish) {
    out = out
      .replace(/\b(kral[ıiİI]m|kralim|my king)\b/gi, "")
      .replace(/\s+([,.!?])/g, "$1")
      .replace(/[,\s]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  return out;
}

function allowAi(userId: number, pinged = false): boolean {
  const now = Date.now();
  if (now - windowStart > 60_000) {
    windowStart = now;
    windowCount = 0;
  }
  if (!pinged && windowCount >= 40) return false;
  windowCount += 1;
  lastAiAt.set(userId, now);
  return true;
}
