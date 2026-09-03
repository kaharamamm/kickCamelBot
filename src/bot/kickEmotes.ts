import { fold } from "./slang.js";
import { KICK_EMOTE_CATALOG } from "./kickEmoteCatalog.js";
import { getEmoteMoodOverrides, saveEmoteMoodOverrides, type EmoteMoodOverrides } from "./emoteMoodStore.js";

export type KickEmote = {
  id: number;
  name: string;
  subscribersOnly: boolean;
  group: string;
};

/** Mood buckets for contextual emote picks. */
export type EmoteMood =
  | "happy"
  | "laugh"
  | "sad"
  | "angry"
  | "fear"
  | "surprise"
  | "disgust"
  | "trust"
  | "anticipation"
  | "hype"
  | "dance"
  | "love"
  | "cool"
  | "confused"
  | "neutral";

/** Plutchik-aligned core + Kick chat vibes. */
export const EMOTE_MOODS: EmoteMood[] = [
  "happy",
  "laugh",
  "sad",
  "angry",
  "fear",
  "surprise",
  "disgust",
  "trust",
  "anticipation",
  "hype",
  "dance",
  "love",
  "cool",
  "confused",
  "neutral",
];

export type UiEmote = {
  id: number;
  name: string;
  mood: EmoteMood;
  defaultMood: EmoteMood;
  img: string;
};

const byName = new Map<string, KickEmote>();
const byMood = new Map<EmoteMood, KickEmote[]>();
const allEmotes: KickEmote[] = [];

function tag(e: KickEmote): string {
  return `[emote:${e.id}:${e.name}]`;
}

function emoteImg(id: number): string {
  return `https://files.kick.com/emotes/${id}/fullsize`;
}

function rebuildIndexes(): void {
  byName.clear();
  byMood.clear();
  allEmotes.length = 0;
  for (const mood of EMOTE_MOODS) byMood.set(mood, []);

  const overrides = getEmoteMoodOverrides();
  for (const row of KICK_EMOTE_CATALOG) {
    const mood = (overrides[row.name] as EmoteMood | undefined) ?? row.mood;
    const e: KickEmote = {
      id: row.id,
      name: row.name,
      subscribersOnly: false,
      group: "static",
    };
    allEmotes.push(e);
    byName.set(e.name.toLowerCase(), e);
    byMood.get(mood)!.push(e);
  }
}

rebuildIndexes();

/** Kick chat token for an emote. */
export function formatKickEmote(e: KickEmote): string {
  return tag(e);
}

/** No-op: catalog is static (kept for boot compatibility). */
export function prefetchKickEmotes(): void {
  /* static catalog — nothing to fetch */
}

/** Re-read mood overrides from disk and rebuild buckets. */
export function reloadEmoteMoodIndex(): void {
  rebuildIndexes();
}

/** Returns the static catalog (async signature kept for call sites). */
export async function loadKickEmotes(_force = false): Promise<KickEmote[]> {
  return allEmotes;
}

/** All emotes with effective mood for the dashboard. */
export function listEmotesForUi(): UiEmote[] {
  return KICK_EMOTE_CATALOG.map((row) => {
    const overrides = getEmoteMoodOverrides();
    const mood = overrides[row.name] ?? row.mood;
    return {
      id: row.id,
      name: row.name,
      mood,
      defaultMood: row.mood,
      img: emoteImg(row.id),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Save mood assignments from the dashboard.
 * Only stores overrides that differ from the static catalog default.
 */
export function saveEmoteMoodsFromUi(assignments: Record<string, EmoteMood>): number {
  const next: EmoteMoodOverrides = {};
  for (const row of KICK_EMOTE_CATALOG) {
    const chosen = assignments[row.name] ?? assignments[String(row.id)];
    if (!chosen) continue;
    if (chosen !== row.mood) next[row.name] = chosen;
  }
  saveEmoteMoodOverrides(next);
  rebuildIndexes();
  return Object.keys(next).length;
}

export async function findKickEmote(name: string): Promise<KickEmote | undefined> {
  const key = name.replace(/^\[emote:\d+:|\]$/gi, "").trim().toLowerCase();
  if (!key) return undefined;
  return byName.get(key) ?? allEmotes.find((e) => e.name.toLowerCase() === key);
}

/** Resolve a spam token (full [emote:…] or bare name) to something we can post. */
export async function resolveEmoteToken(token: string): Promise<string | null> {
  const t = token.trim();
  if (!t) return null;
  if (/^\[emote:\d+:[^\]]+\]$/i.test(t)) {
    const name = t.match(/^\[emote:\d+:([^\]]+)\]$/i)?.[1];
    if (!name) return t;
    const known = await findKickEmote(name);
    return known ? tag(known) : t;
  }
  if (t.length <= 24 && !/\s/.test(t) && !t.startsWith("!")) {
    const known = await findKickEmote(t);
    if (known) return tag(known);
    return t;
  }
  const known = await findKickEmote(t);
  return known ? tag(known) : null;
}

export async function pickRandomKickEmote(): Promise<KickEmote | null> {
  if (!allEmotes.length) return null;
  return allEmotes[Math.floor(Math.random() * allEmotes.length)] ?? null;
}

/** Sync mood pool from the static catalog (+ UI overrides). */
export function getEmotesByMoodSync(mood: EmoteMood): KickEmote[] {
  return byMood.get(mood) ?? [];
}

export async function getEmotesByMood(mood: EmoteMood): Promise<KickEmote[]> {
  return getEmotesByMoodSync(mood);
}

/** Detect mood intent from an order / chat line. */
export function detectEmoteMoodRequest(content: string): EmoteMood | null {
  const f = fold(content);
  if (/(?:mutlu|happy|sevinç|sevinçli|joy|cheerful|yay\b|hosgeld|hoşgeld|welcome)/.test(f)) return "happy";
  if (/(?:gul|gül|laugh|lul|kekw|lol|komik|haha|eheh|gülme|amused)/.test(f)) return "laugh";
  if (/(?:kork|fear|scared|ürk|urk|panic|anxiety|endise|endişe)/.test(f)) return "fear";
  if (/(?:sasir|şaşır|surprise|shock|wtf|lan\s+ne|oooh)/.test(f)) return "surprise";
  if (/(?:igren|iğren|disgust|cringe|wierd|weird|sussy|yuh|tiksin)/.test(f)) return "disgust";
  if (/(?:guven|güven|trust|inan|inanç)/.test(f)) return "trust";
  if (/(?:dans|dance|zipla|zıpla|salla|koştur|kostur|vibe|dj\b|jam\b|ritim|muzik|müzik|groove|shuffle)/.test(f)) {
    return "dance";
  }
  if (/(?:hype|pog|alkis|alkış|heyecan|ateş|ates|fire|hyper|clap|coş|cos|efsane|aslan|lets\s*go|let\s*s\s*go|letsgo)/.test(f)) {
    return "hype";
  }
  if (/(?:anticipation|heycanli|giris|giriş|bekle|bekliyor|yakinda|yakında)/.test(f)) return "anticipation";
  if (/(?:kizgin|kızgın|sinir|angry|mad|rage|ofke|öfke|sinirlen|get\s+mad)/.test(f)) return "angry";
  if (/(?:uzgun|üzgün|sad|agli|ağla|cry|uzul|üzül|bye|gule\s*gule|güle\s*güle)/.test(f)) return "sad";
  if (/(?:ask|aşk|love|opucuk|öpücük|kiss|kalp|heart)/.test(f)) return "love";
  if (/(?:huh|confused|ne\s+diyo|hmm|anlamad)/.test(f)) return "confused";
  if (/(?:cool|havali|havalı|kral|based)/.test(f)) return "cool";
  return null;
}

/** Infer mood from the bot's own reply text (for auto-tagging). */
export function inferMoodFromReply(text: string): EmoteMood | null {
  const f = fold(text);
  if (/(?:mutlu|sevind|harika|süper|super|güzel\s*gun|guzel\s*gun|yay\b|iyi\s*ki|hosgeld|hoşgeld|welcome|hg\b)/.test(f)) {
    return "happy";
  }
  if (/(?:hah+|lol|lmao|ahaha|kek|gül|guluyor|komik|ez\b)/.test(f)) return "laugh";
  if (/(?:kork|ürk|urk|panik|titriyor|scared|help)/.test(f)) return "fear";
  if (/(?:noluyo|ne\s+oluyor|şaşır|sasir|inanamiyorum|shock|wtf)/.test(f)) return "surprise";
  if (/(?:igren|iğren|cringe|yuh|tiksin|midem)/.test(f)) return "disgust";
  if (/(?:guven|güven|yanındayım|yanindayim|sirtini|sırtını)/.test(f)) return "trust";
  if (/(?:dans|dance|zipl|salla|vibe|dj\b|jam\b|groove|ritim|muzik|müzik)/.test(f)) return "dance";
  if (/(?:haydi|hadi|aslan|efsane|pog|helal|fire|heyecan|hype|coş|cos|lets\s*go|let\s*s\s*go)/.test(f)) return "hype";
  if (/(?:bekle|yakinda|yakında|merak|sabirsiz|sabırsız)/.test(f)) return "anticipation";
  if (/(?:sinir|kizgin|ofke|siktir|amk|mal\b|salak|rage|angry)/.test(f)) return "angry";
  if (/(?:uzgun|üzgün|üzül|uzul|yazik|keşke|keske|sorry|üzdü|gule\s*gule|güle\s*güle|bye|bb\b)/.test(f)) {
    return "sad";
  }
  if (/(?:seviyorum|aşk|ask|öp|opucuk|tatli|tatlı)/.test(f)) return "love";
  if (/(?:\?\?\?|ne\s+diyon|anlamadim|anlamadım|huh)/.test(f)) return "confused";
  if (/\*[^*]{2,40}\*/.test(text)) {
    const action = text.match(/\*([^*]+)\*/)?.[1] ?? "";
    const af = fold(action);
    if (/(?:el\s*salla|selamla|karsila|karşıla|gulums|gülüm|mutlu|sevin)/.test(af)) return "happy";
    if (/(?:gul|kahkaha|sırıt|sirit)/.test(af)) return "laugh";
    if (/(?:titre|kork|ürk)/.test(af)) return "fear";
    if (/(?:sasir|şaşır|gozleri\s*ac)/.test(af)) return "surprise";
    if (/(?:igren|yüzünü\s*buruş)/.test(af)) return "disgust";
    if (/(?:kiz|sinir|ofke|bağır|bagir)/.test(af)) return "angry";
    if (/(?:uzul|agli|ağla|iç\s*cek|veda)/.test(af)) return "sad";
    if (/(?:dans|salla|zipl|koştur|kostur|vibe|dj|jam|groove)/.test(af)) return "dance";
    if (/(?:alkis|alkış|heyecan|zıpla|zipla|coş|cos)/.test(af)) return "hype";
    if (/(?:bekle|merak)/.test(af)) return "anticipation";
    return "cool";
  }
  if (/[!]{2,}/.test(text)) return "hype";
  if (/[?]{1,}/.test(text)) return "anticipation";
  return null;
}

export function pickMoodEmotesSync(mood: EmoteMood, count = 1): KickEmote[] {
  const pool = getEmotesByMoodSync(mood);
  if (!pool.length) return [];
  const n = Math.max(1, Math.min(count, pool.length, 6));
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

export async function pickMoodEmotes(mood: EmoteMood, count = 1): Promise<KickEmote[]> {
  return pickMoodEmotesSync(mood, count);
}

export function formatMoodEmoteBurstSync(mood: EmoteMood, count = 1): string | null {
  const picks = pickMoodEmotesSync(mood, count);
  if (!picks.length) return null;
  return picks.map(tag).join(" ");
}

export async function formatMoodEmoteBurst(mood: EmoteMood, count = 1): Promise<string | null> {
  return formatMoodEmoteBurstSync(mood, count);
}

/**
 * Append a mood Kick emote from the static catalog (instant — no network).
 */
export function maybeAppendMoodEmote(reply: string): string {
  if (!reply.trim()) return reply;
  if (/\[emote:\d+:/i.test(reply)) return reply;
  let mood = inferMoodFromReply(reply);
  if (!mood) {
    if (Math.random() > 0.7) return reply;
    const soft: EmoteMood[] = ["happy", "cool", "laugh", "hype", "dance", "anticipation", "confused"];
    mood = soft[Math.floor(Math.random() * soft.length)]!;
  }
  const burst = formatMoodEmoteBurstSync(mood, 1);
  if (!burst) return reply;
  return `${reply.trim()} ${burst}`.trim();
}

/** Tiny optional catalog string (rarely needed — code appends emotes). */
export async function emotePromptHint(limitPerMood = 2): Promise<string> {
  const lines: string[] = ["Kick emotes by mood (code usually appends one):"];
  for (const mood of EMOTE_MOODS) {
    if (mood === "neutral") continue;
    const rows = getEmotesByMoodSync(mood).slice(0, Math.max(1, Math.min(limitPerMood, 3)));
    if (!rows.length) continue;
    lines.push(`${mood}: ${rows.map((e) => tag(e)).join(" ")}`);
  }
  return lines.join("\n");
}

export async function spamKickEmote(token: string, times: number): Promise<string | null> {
  const resolved = await resolveEmoteToken(token);
  if (!resolved) return null;
  const n = Math.max(1, Math.min(8, times));
  return Array(n).fill(resolved).join(" ");
}

/** Expose catalog size for diagnostics. */
export function staticEmoteCount(): number {
  return allEmotes.length;
}
