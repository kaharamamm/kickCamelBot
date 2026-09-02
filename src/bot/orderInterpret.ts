import { extraChannelSlugs } from "./channelStore.js";
import { generateRaw } from "./ai.js";
import { clipChat } from "../kick/api.js";
import { config } from "../config.js";
import { roomSnapshot } from "./chatLog.js";
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
    | "unpin";
  channel?: string;
  text?: string;
  on?: boolean | null;
  seconds?: number | null;
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
]);

const ORDER_SYSTEM = `You interpret streamer orders to a Kick chat bot (CamelBot).
Reply with ONE JSON object only. No markdown. No extra keys.

Schema:
{"action":"none|say|command|clear|skip|title|category|emoteonly|slow|followonly|subonly|clip|raid|pin|unpin","channel":"","text":"","on":null,"seconds":null}

Critical rules:
- Understand FULL CONTEXT in Turkish or English. Slang, typos, suffixes (kaiserin, kaiser'a) all count.
- Verbs like sor/ask, yaz/write, söyle/say, der/söyle, git/go, katıl/join are ORDERS — never part of posted text.
- action=say: "text" MUST be the exact natural message to appear in that channel's chat.
  Compose it properly. Example: "yardıma ihtiyacı olup olmadığını sor" → text:"Yardıma ihtiyacın var mı?"
  Example: "keller der misin" → text:"keller"
  Example: "ask if they need help" → text:"Do you need any help?"
- action=say: "channel" = target Kick slug/nick, or "home" for the streamer's own channel.
  "benim kanal", "my channel", "kendi kanalım", "mcvckaharamamm" = HOME (streamer's channel), NOT an extra channel.
- action=command: run a bot chat command. "text" = full command like "!commands" or "!ping".
  Example: "!commands komutunu çalıştır" → action:command, text:"!commands"
  Example: "run !ping" → action:command, text:"!ping"
- Compound orders with "sonra/sonrada/and then": only interpret ONE step — caller splits them.
- action=pin: post "text" in home channel (or registered extra if channel set), then pin that message.
  Example: "Ben bir malım yazıp sabitle" → action:pin, text:"Ben bir malım"
- Posting (say) works on HOME and on registered extra channels. Raid/host can use any Kick username.
- action=unpin: remove pinned message from chat.
- emoteonly/slow/followonly/subonly: on=true/false/null; seconds for timed modes.
- If the streamer is chatting, joking, or not giving a bot command: action=none.
- Use recent chat context for follow-ups (e.g. prior message mentioned kaiser's channel, now they say "yardıma ihtiyacı olup olmadığını sor").`;

/** True when regex alone is risky — prefer AI to compose the real message. */
export function needsAiInterpretation(content: string): boolean {
  const t = fold(content);
  if (!t || t.length > 320) return false;
  if (/(?:sabitle|pin(?:ned)?|sabit)/.test(t)) return true;
  if (isClearOrder(content) || isSkipOrder(content)) return false;
  if (/(?:sor|sorar|sorsana|sorsene|ask|question|merak|kontrol)/.test(t)) return true;
  if (/(?:git|gidip|join|katil).{0,40}(?:kanal|channel)/.test(t)) return true;
  if (resolveRegisteredChannel(content) && /(?:git|gidip|join|katil|sor|yaz|soyle|der|ve|and)/.test(t)) {
    return true;
  }
  if (t.split(/\s+/).length >= 6) return true;
  return false;
}

export function mightBeKingOrder(content: string): boolean {
  const t = content.replace(/\s+/g, " ").trim();
  if (!t || t.length > 320) return false;
  if (isClearOrder(t) || isSkipOrder(t)) return true;
  const f = fold(t);
  if (/(?:raid|host|baskin|raidle|hostla|title|baslik|category|kategori|emote|slow|yavas|follow|subonly|clip|klip)/.test(f)) {
    return true;
  }
  if (/(?:sabitle|pin(?:ned)?|sabit)/.test(f)) return true;
  if (/(?:git|gidip|join|katil|sor|yaz|soyle|der|desene|yazsana|sil|temizle|clear|skip|atla|gec|calistir|çalıştır|calistir|run|execute|komut)/.test(f)) {
    return true;
  }
  if (resolveRegisteredChannel(t)) return true;
  if (isHomeChannelRef(t)) return true;
  if (/(?:@?camelbot|@?camel|\bbot\b)/.test(f)) {
    return /(?:git|gidip|sor|yaz|soyle|der|desene|sil|clear|skip|raid|host|title|baslik|emote|slow|clip|katil|join|kanal|channel|temizle|atla|gec|sabitle|pin|sabit)/.test(
      f,
    );
  }
  return false;
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
  const parts: string[] = [];
  let rest = content.replace(/\s+/g, " ").trim();
  const splitRe =
    /\s+(?:sonra(?:\s+(?:da|de)|da|de)?|and then|then|ve sonra|ardından)\s+(?=!\w+|(?:çalıştır|calistir|run|execute|git|gidip|clear|skip|atla|temizle|raid|host|sabitle|pin)\b)/i;

  for (;;) {
    const m = rest.match(splitRe);
    if (!m || m.index === undefined) {
      if (rest) parts.push(rest);
      break;
    }
    const head = rest.slice(0, m.index).trim();
    if (!head) {
      parts.push(rest);
      break;
    }
    parts.push(head);
    rest = rest.slice(m.index + m[0].length).trim();
  }

  return parts.length > 0 ? parts : [content.trim()];
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
  const channels = extraChannelSlugs();
  const homeHint = homeSlug
    ? `Home streamer channel: ${homeSlug} — "benim kanal", "my channel", "kendi kanalım" = this channel.`
    : 'Home = streamer\'s own channel ("benim kanal" / "my channel").';
  const channelHint =
    channels.length > 0
      ? `${homeHint} Registered extra channels: ${channels.join(", ")}`
      : `${homeHint} No extra channels registered yet.`;
  const context =
    broadcasterUserId && broadcasterUserId > 0
      ? roomSnapshot(broadcasterUserId, undefined, 6)
      : "";
  const contextHint = context ? `Recent chat (for follow-ups like "sor that there"):\n${context}` : "";

  const examples = [
    'Order: "camel git kaiserin kanalına ve yardıma ihtiyacı olup olmadığını sor" → {"action":"say","channel":"kaiserdoto","text":"Yardıma ihtiyacın var mı?","on":null,"seconds":null}',
    'Order: "kaiserin kanala gidip keller der misin" → {"action":"say","channel":"kaiserdoto","text":"keller","on":null,"seconds":null}',
    'Order: "bot chati silsene" → {"action":"clear","channel":"","text":"","on":null,"seconds":null}',
    'Order: "şarkıyı geç" → {"action":"skip","channel":"","text":"","on":null,"seconds":null}',
    'Order: "benim kanala gidip bir selam kralım yaz" → {"action":"say","channel":"home","text":"selam kralım","on":null,"seconds":null}',
    'Order: "benim kanala naber lan yarram yaz" → {"action":"say","channel":"home","text":"naber lan yarram","on":null,"seconds":null}',
    'Order: "!commands komutunu çalıştır" → {"action":"command","channel":"","text":"!commands","on":null,"seconds":null}',
    'Order: "camel \\"Ben bir malım\\" yazıp sabitlesene o mesajını" → {"action":"pin","channel":"","text":"Ben bir malım","on":null,"seconds":null}',
    'Order: "how are you camel" → {"action":"none","channel":"","text":"","on":null,"seconds":null}',
  ].join("\n");

  const raw = await generateRaw(
    [`Streamer order:\n${content.slice(0, 400)}`, channelHint, contextHint, examples].filter(Boolean).join("\n\n"),
    ORDER_SYSTEM,
    { standalone: true, timeoutMs: 12_000, tokens: 280, temperature: 0 },
  );
  return parseOrderJson(raw);
}

function parseOrderJson(raw: string | null): InterpretedOrder | null {
  if (!raw) return null;
  const json = raw.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as { action?: string; channel?: string; text?: string; on?: boolean | null; seconds?: number | null };
    const action = parsed.action === "host" ? "raid" : parsed.action;
    if (!action || !ACTIONS.has(action)) return null;
    return { ...parsed, action: action as InterpretedOrder["action"] };
  } catch {
    return null;
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
