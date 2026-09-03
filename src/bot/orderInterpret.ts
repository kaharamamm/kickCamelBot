import { extraChannelSlugs } from "./channelStore.js";
import { generateRaw } from "./ai.js";
import { clipChat } from "../kick/api.js";
import { config } from "../config.js";
import { lastBotQuotedText, lastBotSuggestedChange, recentDialogue } from "./chatLog.js";
import { chatSummary } from "./chatMemory.js";
import { extractChannelTarget, resolveRegisteredChannel } from "./remoteSay.js";
import { extractQuoted, fold, isClearOrder, isSkipOrder } from "./slang.js";

export type InterpretedOrder = {
  action:
    | "none"
    | "say"
    | "command"
    | "clear"
    | "skip"
    | "title"
    | "category"
    | "emoteonly"
    | "slow"
    | "followonly"
    | "subonly"
    | "clip"
    | "raid"
    | "pin"
    | "unpin"
    | "discord_voice"
    | "ban"
    | "timeout"
    | "emote";
  channel?: string;
  text?: string;
  on?: boolean | null;
  seconds?: number | null;
  /** discord_voice: verbatim | riff | join | leave | repeat */
  mode?: string;
};

const ACTIONS = new Set([
  "none",
  "say",
  "command",
  "clear",
  "skip",
  "title",
  "category",
  "emoteonly",
  "slow",
  "followonly",
  "subonly",
  "clip",
  "raid",
  "pin",
  "unpin",
  "discord_voice",
  "ban",
  "timeout",
  "emote",
]);

const ORDER_SYSTEM = `You are the order-understanding brain for CamelBot (Kick + Discord).
Given the streamer's latest message PLUS recent dialogue, decide if they want the bot to DO something, or just CHAT.

Reply with ONE JSON object only. No markdown.

Schemas (pick one):
- Single order: {"action":"none|say|command|clear|skip|title|category|emoteonly|slow|followonly|subonly|clip|raid|pin|unpin|discord_voice|ban|timeout|emote","channel":"","text":"","on":null,"seconds":null,"mode":""}
- Multiple orders in ONE message: {"orders":[ {...}, {...} ]}

How to think:
1) Read recent dialogue.
2) Decide intent of the LATEST message — not keyword matching alone.
3) Short follow-ups like "tamam yap" mean APPLY a pending suggestion.
4) Asking for ideas is CHAT → action=none.
5) Only emit actions when they want them executed now.

- emote: post Kick emotes into Kick chat. text = emote name if named. mode = happy|laugh|sad|angry|fear|surprise|disgust|trust|anticipation|hype|dance|love|cool|confused when they ask by mood ("go happy", "hype emoji", "dans emote", "kızgın emoji", "sad emotes").
  NEVER use action=command for emoji/emote asks.

Discord voice (discord_voice) — DC / Discord / "benim olduğum DC kanalı" / "dc ye gelip …":
- mode=join → ONLY join (no speak). Use ONLY when they only asked to enter.
- mode=leave → leave voice.
- mode=verbatim + text = exact phrase to speak after joining ("… de", "say X").
- mode=riff + text = invent spoken line that DOES the ask (e.g. "bana hali hatırımı sor" → text="halini hatırını sor", then speak a real nasılsın check-in — do NOT only join).
- "gelip / girip / katıl" + anything to say or ask = join AND speak (verbatim or riff), NEVER mode=join alone.

Kick stream: title/category/say/clear/skip/clip/raid/pin/unpin/emoteonly/slow/followonly/subonly/command/ban/timeout.

Language: Turkish and English slang count.`;

/**
 * Cheap prefilter: should we spend an AI call to understand a possible order?
 * Prefer "yes when talking to the bot" over keyword lists — understanding is the AI's job.
 */
export function shouldTryKingOrder(opts: {
  content: string;
  addressed: boolean;
  continuing: boolean;
}): boolean {
  const t = opts.content.replace(/\s+/g, " ").trim();
  if (!t || t.length > 320) return false;
  if (isClearOrder(t) || isSkipOrder(t) || t.startsWith(config.bot.prefix)) return true;
  if (opts.addressed || opts.continuing) return true;
  const f = fold(t);
  if (/(?:raid|host|baskin|baslik|title|kategori|category|\boyun\b|\bgame\b|emote|emoji|slow|clip|klip|sabitle|unpin|\bban\b|timeout|sustur|discord|\bdc\b)/.test(f)) {
    return true;
  }
  if (resolveRegisteredChannel(t) && /(?:git|gidip|yaz|sor|soyle|der|katil|join)/.test(f)) return true;
  return false;
}

/** @deprecated use shouldTryKingOrder */
export function mightBeKingOrder(content: string, _broadcasterUserId?: number): boolean {
  return shouldTryKingOrder({ content, addressed: true, continuing: false });
}

export function isHomeChannelRef(text: string, homeSlug?: string): boolean {
  const f = fold(text);
  if (/(?:benim|bizim|kendi|ana|asil)\s+kanal/.test(f)) return true;
  if (/\b(?:my|home|own|main)\s+channel/.test(f)) return true;
  if (/\bburaya\b/.test(f) && /(?:yaz|soyle|der|git|gidip)/.test(f)) return true;
  if (/\b(?:mcvck|kaharamamm|camelamamm|mcvckaharamamm)\b/.test(f)) return true;
  if (homeSlug && f.includes(fold(homeSlug))) return true;
  return false;
}

export function splitCompoundOrder(content: string): string[] {
  const t = content.replace(/\s+/g, " ").trim();
  if (!t) return [];

  // Match on folded text (Turkish ı/ş/ğ → ascii) but slice the original string.
  const f = fold(t);

  // Explicit sequencing: "sonra / and then / ardından"
  const sequenced = splitOriginalByFoldedRegex(
    t,
    f,
    /\s+(?:sonra(?:\s+(?:da|de)|da|de)?|and then|then|ve sonra|ardindan)\s+/gi,
  );
  if (sequenced.length > 1) return sequenced;

  // Parallel asks: "… yap, yayın başlığını da …" / "… and also set title …"
  const titleOrGame =
    "(?:(?:yayin(?:in)?|stream(?:in)?)\\s+)?(?:baslig(?:i(?:ni|n)?|ini)?|title|kategori|category|oyun(?:u|un)?|game)";
  const afterJoin = `(?:(?:(?:set|change|update|make|put|koy|yap|degistir|cevir)\\s+(?:the\\s+|bir\\s+)?)?${titleOrGame}|emote|slow|raid|host)`;
  const parallel = splitOriginalByFoldedRegex(
    t,
    f,
    new RegExp(`\\s*,\\s*(?=${afterJoin}\\b)|(?:\\s+(?:ve|and|also|plus)\\s+)(?=${afterJoin}\\b)`, "gi"),
  );
  if (parallel.length > 1) return parallel;

  return [t];
}

/** Split `original` using match indices found on length-preserving `folded`. */
function splitOriginalByFoldedRegex(original: string, folded: string, re: RegExp): string[] {
  const matches: Array<{ index: number; len: number }> = [];
  let m: RegExpExecArray | null;
  const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  while ((m = global.exec(folded)) !== null) {
    matches.push({ index: m.index, len: m[0].length });
  }
  if (!matches.length) return [original];
  const parts: string[] = [];
  let last = 0;
  for (const hit of matches) {
    const head = original.slice(last, hit.index).trim();
    if (head) parts.push(head);
    last = hit.index + hit.len;
  }
  const tail = original.slice(last).trim();
  if (tail) parts.push(tail);
  return parts.length > 1 ? parts : [original];
}

export function parseCommandInvoke(content: string): InterpretedOrder | null {
  const t = content.replace(/\s+/g, " ").trim();
  if (!t) return null;
  const prefix = config.bot.prefix;
  const f = fold(t);

  if (t.startsWith(prefix)) {
    const cmd = t.split(/\s+/)[0] ?? t;
    return { action: "command", text: cmd };
  }

  const bang = t.match(/(!\w+)/)?.[1];
  if (bang && /(?:çalıştır|calistir|run|execute|komut)/.test(f)) {
    return { action: "command", text: bang };
  }

  const runFirst = t.match(/(?:çalıştır|calistir|run|execute)\s+(?:the\s+)?(!?\w+)/i)?.[1];
  if (runFirst) {
    const cmd = runFirst.startsWith("!") ? runFirst : `${prefix}${runFirst.replace(/^!+/, "")}`;
    return { action: "command", text: cmd };
  }

  const runAfter = t.match(/(!?\w+)\s+(?:komutunu|komut|command)\s*(?:u|unu|ünü|unu)?\s*(?:çalıştır|calistir|run|execute)/i)?.[1];
  if (runAfter) {
    const cmd = runAfter.startsWith("!") ? runAfter : `${prefix}${runAfter.replace(/^!+/, "")}`;
    return { action: "command", text: cmd };
  }

  return null;
}

export function extractHomeSayText(content: string): string | null {
  const quoted = extractQuoted(content);
  if (quoted) return quoted;

  let trimmed = content
    .replace(/\s+(?:yaz|yazsana|yazsene|yazip|yazıp|soyle|söyle|der(?:\s*m[ıi]s[ıi]n)?|say)\s*$/i, "")
    .trim();
  trimmed = trimmed
    .replace(/\s+(?:sonra(?:\s+(?:da|de)|da|de)?|and then|then|ve sonra|ardından)\b[\s\S]*$/i, "")
    .trim();
  trimmed = trimmed
    .replace(/\s+[!]?\w+\s+(?:komutunu|komut|command)\s*(?:çalıştır|calistir|run|execute)[\s\S]*$/i, "")
    .trim();
  const text = cleanHomePayload(trimmed);
  return text || null;
}

function cleanHomePayload(raw: string): string {
  const kept: string[] = [];
  for (const tok of raw.split(/[\s,]+/).filter(Boolean)) {
    const t = fold(tok).replace(/^@/, "");
    if (isHomeFillerWord(t)) continue;
    kept.push(tok.replace(/^['"`“”‘’]|['"`“”‘’]$/g, ""));
  }
  return clipChat(kept.join(" ").trim());
}

function isHomeFillerWord(token: string): boolean {
  return /^(benim|bizim|kendi|kanal|kanala|kanalina|kanalima|kanalim|channel|my|home|git|gidip|go|to|ve|and|bir|bi|su|camel|bot|camelbot|pls|please|lutfen|mcvck|kaharamamm|mcvckaharamamm|yaz|yazsana|yazip|soyle|der|say|gidip|sonra|sonrada|komut|komutunu|calistir|çalıştır|run|execute|command)$/.test(
    token,
  );
}

export function parseHomeSay(content: string): InterpretedOrder | null {
  if (!isHomeChannelRef(content)) return null;
  if (!/(?:yaz|soyle|söyle|der|sor|say)/i.test(content)) return null;
  const text = extractHomeSayText(content);
  if (!text) return null;
  return { action: "say", channel: "home", text };
}

export async function interpretOrder(
  content: string,
  broadcasterUserId?: number,
  homeSlug?: string,
): Promise<InterpretedOrder | null> {
  const list = await interpretOrders(content, broadcasterUserId, homeSlug);
  return list[0] ?? null;
}

/** Understand one or many executable orders from a single streamer message. */
export async function interpretOrders(
  content: string,
  broadcasterUserId?: number,
  homeSlug?: string,
): Promise<InterpretedOrder[]> {
  const channels = extraChannelSlugs();
  const homeHint = homeSlug
    ? `Home streamer channel: ${homeSlug} — "benim kanal" / "my channel" = this channel.`
    : 'Home = streamer\'s own channel ("benim kanal" / "my channel").';
  const channelHint =
    channels.length > 0
      ? `${homeHint} Registered extra channels: ${channels.join(", ")}`
      : `${homeHint} No extra channels registered yet.`;

  const dialogue =
    broadcasterUserId && broadcasterUserId > 0 ? recentDialogue(broadcasterUserId, 10) : "";
  const roomMem =
    broadcasterUserId && broadcasterUserId > 0 ? chatSummary(broadcasterUserId) : "";
  const pendingQuote =
    broadcasterUserId && broadcasterUserId > 0 ? lastBotQuotedText(broadcasterUserId) : null;
  const pendingKind =
    broadcasterUserId && broadcasterUserId > 0 ? lastBotSuggestedChange(broadcasterUserId) : null;

  const pendingHint = pendingQuote
    ? `Pending bot suggestion (${pendingKind ?? "unknown"}): "${pendingQuote}"\nIf the latest message is approving/applying that suggestion, emit action=${pendingKind === "category" ? "category" : "title"} with text set to that exact suggestion (or "__invent__" only if they ask you to invent something new).`
    : "No pending quoted suggestion.";

  const dialogueHint = dialogue
    ? `Last 10 chat lines (oldest→newest):\n${dialogue}`
    : "Last 10 chat lines: (none)";
  const roomHint = roomMem
    ? `Room summary (what chat has been talking about): ${roomMem}`
    : "Room summary: (none yet)";

  const raw = await generateRaw(
    [
      `Latest streamer message:\n${content.slice(0, 500)}`,
      dialogueHint,
      roomHint,
      pendingHint,
      channelHint,
      'If this message has multiple asks, reply with {"orders":[...]} covering ALL of them.',
    ].join("\n\n"),
    ORDER_SYSTEM,
    { standalone: true, timeoutMs: 90_000, tokens: 480, temperature: 0 },
  );
  return parseOrdersJson(raw);
}

function asOrder(row: {
  action?: string;
  channel?: string;
  text?: string;
  on?: boolean | null;
  seconds?: number | null;
  mode?: string;
}): InterpretedOrder | null {
  const action = row.action === "host" ? "raid" : row.action;
  if (!action || !ACTIONS.has(action)) return null;
  if (action === "none") return { action: "none" };
  return {
    action: action as InterpretedOrder["action"],
    channel: row.channel,
    text: row.text,
    on: row.on ?? null,
    seconds: row.seconds ?? null,
    mode: row.mode,
  };
}

function parseOrdersJson(raw: string | null): InterpretedOrder[] {
  if (!raw) return [];
  const json = raw.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as {
      action?: string;
      channel?: string;
      text?: string;
      on?: boolean | null;
      seconds?: number | null;
      orders?: Array<{
        action?: string;
        channel?: string;
        text?: string;
        on?: boolean | null;
        seconds?: number | null;
      }>;
    };

    if (Array.isArray(parsed.orders)) {
      return parsed.orders.map(asOrder).filter((o): o is InterpretedOrder => Boolean(o && o.action !== "none"));
    }

    const one = asOrder(parsed);
    if (!one || one.action === "none") return one?.action === "none" ? [{ action: "none" }] : [];
    return [one];
  } catch {
    return [];
  }
}

export function resolveSayChannel(order: InterpretedOrder, original: string, homeSlug: string): string | null {
  const blob = `${order.channel ?? ""} ${original}`;
  const ch = fold(order.channel || "");
  if (ch === "home" || ch === fold(homeSlug)) return homeSlug.toLowerCase();
  if (isHomeChannelRef(blob, homeSlug)) return homeSlug.toLowerCase();
  return (
    resolveRegisteredChannel(order.channel || "") ||
    resolveRegisteredChannel(original) ||
    resolveRegisteredChannel(blob) ||
    null
  );
}

export function resolveRaidTarget(order: InterpretedOrder, original: string): string | null {
  return extractChannelTarget(`${order.channel ?? ""} ${order.text ?? ""} ${original}`);
}
