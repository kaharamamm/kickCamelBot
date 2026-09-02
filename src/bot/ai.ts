import { config } from "../config.js";
import { clipChat } from "../kick/api.js";
import { stripBotTags } from "./bots.js";
import { formatAnkaraClock } from "./clock.js";
import { roomSnapshot } from "./chatLog.js";
import { isGreeting } from "./lang.js";
import { personNote } from "./memory.js";
import { recapFacts } from "./recap.js";
import { weatherCached, yenimahalleWeather } from "./weather.js";
import { buildSystemPrompt } from "./settings.js";

const history = new Map<string, Array<{ role: "user" | "model"; text: string }>>();
const lastAiAt = new Map<number, number>();
let windowStart = 0;
let windowCount = 0;

const MODEL_FALLBACKS = [
  config.gemini.model,
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
].filter((name, i, all) => name && all.indexOf(name) === i);

function systemPrompt(opts?: { omitLore?: boolean }): string {
  return buildSystemPrompt(config.bot.name, opts);
}

function clipAi(text: string): string {
  return clipChat(text);
}

type GeminiOpts = {
  standalone?: boolean;
  omitLore?: boolean;
  timeoutMs?: number;
  tokens?: number;
  temperature?: number;
};

async function geminiText(
  prompt: string,
  extraSystem: string,
  opts?: GeminiOpts,
): Promise<string | null> {
  if (!config.gemini.apiKey) return null;
  const timeoutMs = opts?.timeoutMs ?? 5000;
  const tokens = opts?.tokens ?? 160;
  const temperature = opts?.temperature ?? 0.9;
  const system = opts?.standalone
    ? extraSystem || "Follow the user instructions. Plain text only."
    : `${systemPrompt({ omitLore: opts?.omitLore })}${extraSystem ? `\n${extraSystem}` : ""}`;
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: tokens, temperature },
  });
  const started = Date.now();
  const models = timeoutMs <= 2500 ? MODEL_FALLBACKS.slice(0, 1) : MODEL_FALLBACKS.slice(0, 2);
  for (const model of models) {
    const left = timeoutMs - (Date.now() - started);
    if (left < 350) break;
    const text = await geminiOnce(model, body, left);
    if (text) return text;
  }
  return null;
}

async function geminiOnce(model: string, body: string, timeoutMs: number): Promise<string | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(config.gemini.apiKey)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: ac.signal,
    });
    if (!res.ok) {
      console.warn("[ai] Gemini error", model, res.status, (await res.text()).slice(0, 200));
      return null;
    }
    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    return json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim() || null;
  } catch (err) {
    if (ac.signal.aborted) console.warn("[ai] Gemini timeout", model, `${timeoutMs}ms`);
    else console.warn("[ai] Gemini fail", model, err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function generateRaw(
  prompt: string,
  extraSystem = "",
  opts?: { standalone?: boolean },
): Promise<string | null> {
  return geminiText(prompt, extraSystem, {
    standalone: opts?.standalone,
    timeoutMs: 8000,
    tokens: 220,
    temperature: 0.7,
  });
}

export async function generateLine(prompt: string, opts?: { omitLore?: boolean; timeoutMs?: number }): Promise<string | null> {
  const timeoutMs = opts?.timeoutMs ?? 2500;
  const tokens = timeoutMs <= 2500 ? 200 : timeoutMs >= 10_000 ? 280 : 240;
  const text = await geminiText(prompt, "", {
    omitLore: opts?.omitLore,
    timeoutMs,
    tokens,
    temperature: 0.9,
  });
  if (!text) return null;
  return clipAi(stripBotTags(text));
}

export function shouldTalkToAi(content: string): boolean {
  if (!config.gemini.apiKey) return false;
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
  },
): Promise<string | null> {
  if (!config.gemini.apiKey) return null;
  if (!extra?.force && !shouldTalkToAi(chat.content) && !extra?.parentWasBot && !extra?.calledBot && !extra?.calledMods && !extra?.insulted) {
    return null;
  }
  if (!extra?.fromKing && !allowAi(chat.sender.user_id, Boolean(extra?.parentWasBot || extra?.force))) return null;

  const greeting = isGreeting(chat.content);
  const tier = extra?.insulted || extra?.calledBot || greeting ? "snappy" : askTier(chat.content);
  const timeoutMs = tier === "hard" ? 10_000 : tier === "research" ? 5_000 : 2_500;
  const weather = tier === "snappy" ? weatherCached() : await yenimahalleWeather();
  const userKey = String(chat.sender.user_id);
  const prior = greeting ? [] : (history.get(userKey) ?? []).slice(tier === "snappy" ? -2 : -4);
  const memory = greeting || tier === "snappy" ? "" : personNote(chat.sender.user_id);
  const conversation = prior
    .map((t) => `${t.role === "user" ? "Them" : "You"}: ${t.text}`)
    .join("\n");
  const room =
    greeting || tier === "snappy" || !chat.broadcaster?.user_id
      ? ""
      : roomSnapshot(chat.broadcaster.user_id, chat.sender.user_id, 5);
  const prompt = [
    "Answer using this priority. Higher wins if they conflict:",
    "1) THIS CONVERSATION with them",
    "2) THEIR LAST MESSAGE (you must answer this)",
    "3) CHAT LOG snapshot (room flavor only)",
    "4) THEIR SUMMARY (background only if it fits 1 and 2)",
    extra?.streamTitle ? `Stream title: ${extra.streamTitle}` : "",
    extra?.game ? `Game: ${extra.game}` : "",
    tier === "research" || tier === "hard"
      ? `STREAM RECAP FACTS (do not invent names): ${recapFacts()}`
      : "",
    `Ankara time: ${formatAnkaraClock()}`,
    `Weather: ${weather}`,
    extra?.lang === "tr"
      ? "Reply ONLY in Turkish. Do not mix in English. Do not say Kralım, my king, or king."
      : extra?.lang === "en"
        ? "Reply ONLY in English. Do not mix in Turkish. Never say Kralım, kralim, or my king."
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
        ? "This message is about mcvckaharamamm. Nickname only, never real names. Light roast of him is ok. Never say Kralım or my king."
        : "Do NOT mention mcvckaharamamm, Kralım, my king, or king in this reply. Never use anyone's real name.",
    extra?.insulted
      ? `They insulted you. Reply ONLY in ${extra?.lang === "tr" ? "Turkish" : extra?.lang === "en" ? "English" : "their language"}. Roast them about WHAT THEY JUST SAID. Stay in this conversation. Do not mention Dota, heroes, MMR, Meepo, or hair unless they did. Address ${chat.sender.username} in SECOND PERSON. Never start with "Did you call me?". Fresh insult.`
      : extra?.calledBot
        ? `They called you "bot" instead of ${config.bot.name}. You may clap back that you have a name, but NEVER start with "Did you call me?" or the same opener twice.`
        : "",
    extra?.heatWarn
      ? "They keep insulting you. Warn that you know how to shut them up if they don't stop. Do not claim you already timed them out."
      : "",
    greeting
      ? "THIS MESSAGE IS A GREETING. Greet back. Do not roast. Do not tell them to calm down, chill, sakin ol, or that they need to relax. Do not bring up older chat."
      : "",
    "You may add one emotion/action with *stars* (like *clapping* or *blushing*), or **bold** / _italic_ / quotes like \"SHUT UP!\". Do not spam formatting.",
    conversation ? `[1 CONVERSATION]\n${conversation}` : "[1 CONVERSATION]\n(none yet)",
    `[2 LAST MESSAGE] ${chat.sender.username}: ${chat.content}`,
    room ? `[3 CHAT LOG] ${room}` : "[3 CHAT LOG] (quiet)",
    memory ? `[4 SUMMARY] ${memory}` : "[4 SUMMARY] (none)",
    "Write one Kick chat reply. Stay inside [1] and answer [2]. [3] is flavor. [4] is last and only if it fits. One or two words is a valid comeback. A short paragraph is fine when the bit needs it. Do not dump a long paragraph every time.",
  ]
    .filter(Boolean)
    .join("\n");

  const text = await generateLine(prompt, {
    omitLore: Boolean(extra?.insulted || (tier === "snappy" && !extra?.allowKing)),
    timeoutMs,
  });
  if (!text) {
    if (extra?.fromKing) {
      return extra.lang === "en" ? "Yeah, I'm here." : "Buradayım.";
    }
    if (extra?.parentWasBot || extra?.force) {
      return extra.lang === "en" ? "Still talking to me. Say it again." : "Hâlâ bana yazıyorsun. Devam et.";
    }
    return extra?.force ? null : "AI is taking a nap. Commands still work — try !commands";
  }
  const cleaned = enforceReplyLang(stripBotTags(text) || text, extra?.lang);
  rememberAiTurn(userKey, chat.content, cleaned);
  return cleaned;
}

function askTier(content: string): "snappy" | "research" | "hard" {
  const t = content.toLowerCase();
  if (t.length > 220 || /\b(compare|analiz|explain in detail|adım adım|break down)\b/i.test(t)) return "hard";
  if (
    /\b(weather|hava durumu|sıcak|sicak|yağmur|yagmur|derece|saat kaç|what time|tarih|neden|why |how (do|does|did|to|can)|explain|wiki|mmr|rank|who is|kimdir|nasıl çalış)\b/i.test(
      t,
    )
  ) {
    return "research";
  }
  return "snappy";
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
