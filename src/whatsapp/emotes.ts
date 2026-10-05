import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EMOTE_MOODS, type EmoteMood, inferMoodFromReply } from "../bot/kickEmotes.js";

const storePath = join(fileURLToPath(new URL(".", import.meta.url)), "../../data/whatsapp-emojis.json");

/** Grapheme clusters that look like WhatsApp-style emoji (incl. ZWJ sequences). */
const EMOJI_CHUNK =
  /(?:\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)/gu;

/** Default Unicode emoji pools by mood — what people actually use on WhatsApp. */
const MOOD_EMOJI: Record<EmoteMood, string[]> = {
  happy: ["😊", "😄", "🙂", "☺️", "😁", "🥳"],
  laugh: ["😂", "🤣", "😆", "💀", "😹", "🤭"],
  sad: ["😢", "😔", "🥺", "💔", "😞"],
  angry: ["😤", "😠", "🤬", "💢", "👿"],
  fear: ["😨", "😰", "🫣", "😱"],
  surprise: ["😮", "😲", "🤯", "😳", "‼️"],
  disgust: ["🤢", "🤮", "😖", "🙄"],
  trust: ["🤝", "🫡", "💪", "✅"],
  anticipation: ["👀", "⏳", "🤔", "🫢"],
  hype: ["🔥", "🚀", "💯", "⚡", "🎉", "👏"],
  dance: ["💃", "🕺", "🎶", "🪩"],
  love: ["❤️", "🥰", "😍", "💕", "😘"],
  cool: ["😎", "🆒", "🗿", "😏", "🐪"],
  confused: ["🤷", "🤷‍♂️", "❓", "😕", "🫠"],
  neutral: ["👍", "✨", "🙏", "😌"],
};

type EmojiStore = {
  /** emoji → times seen in allowlisted WhatsApp chats */
  seen: Record<string, number>;
  /** emoji → mood override (only when different from catalog default) */
  moods: Record<string, EmoteMood>;
  /** emojis turned off — never appended */
  disabled: string[];
};

function emptyStore(): EmojiStore {
  return { seen: {}, moods: {}, disabled: [] };
}

function isMood(value: unknown): value is EmoteMood {
  return typeof value === "string" && (EMOTE_MOODS as string[]).includes(value);
}

function defaultMoodFor(emoji: string): EmoteMood | null {
  for (const mood of EMOTE_MOODS) {
    if ((MOOD_EMOJI[mood] ?? []).includes(emoji)) return mood;
  }
  return null;
}

function catalogEmojis(): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const mood of EMOTE_MOODS) {
    for (const e of MOOD_EMOJI[mood] ?? []) {
      if (seen.has(e)) continue;
      seen.add(e);
      out.push(e);
    }
  }
  return out;
}

function readStore(): EmojiStore {
  try {
    if (!existsSync(storePath)) {
      writeStore(emptyStore());
      return emptyStore();
    }
    const raw = JSON.parse(readFileSync(storePath, "utf8")) as Partial<EmojiStore>;
    const moods: Record<string, EmoteMood> = {};
    for (const [e, m] of Object.entries(raw.moods ?? {})) {
      if (e.trim() && isMood(m)) moods[e] = m;
    }
    const disabled = Array.isArray(raw.disabled)
      ? [...new Set(raw.disabled.map((x) => String(x).trim()).filter(Boolean))]
      : [];
    return {
      seen: raw.seen && typeof raw.seen === "object" ? raw.seen : {},
      moods,
      disabled,
    };
  } catch {
    return emptyStore();
  }
}

function writeStore(store: EmojiStore): void {
  mkdirSync(dirname(storePath), { recursive: true });
  const trimmedSeen: Record<string, number> = {};
  const entries = Object.entries(store.seen).sort((a, b) => b[1] - a[1]).slice(0, 120);
  for (const [e, n] of entries) trimmedSeen[e] = n;
  writeFileSync(
    storePath,
    JSON.stringify(
      {
        seen: trimmedSeen,
        moods: store.moods,
        disabled: store.disabled,
      },
      null,
      2,
    ),
  );
}

let cache: EmojiStore | null = null;

function getStore(): EmojiStore {
  if (!cache) cache = readStore();
  return cache;
}

function effectiveMood(emoji: string): EmoteMood {
  const store = getStore();
  if (store.moods[emoji] && isMood(store.moods[emoji])) return store.moods[emoji]!;
  return defaultMoodFor(emoji) ?? "neutral";
}

function isEnabled(emoji: string): boolean {
  return !getStore().disabled.includes(emoji);
}

export function extractWhatsAppEmojis(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(EMOJI_CHUNK)) {
    const e = m[0]?.trim();
    if (!e || seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return out;
}

/** Learn emoji from inbound/outbound WhatsApp text (allowlisted traffic only). */
export function noteWhatsAppEmojisFromText(text: string): void {
  const emojis = extractWhatsAppEmojis(text);
  if (!emojis.length) return;
  const store = getStore();
  let changed = false;
  for (const e of emojis) {
    store.seen[e] = (store.seen[e] ?? 0) + 1;
    // New learned emoji with no catalog default → start in neutral unless overridden
    if (!defaultMoodFor(e) && !store.moods[e]) {
      store.moods[e] = "neutral";
    }
    changed = true;
  }
  if (changed) writeStore(store);
}

function pickOne(pool: string[]): string | null {
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)] ?? null;
}

function moodPool(mood: EmoteMood): string[] {
  const store = getStore();
  const all = new Set<string>([...catalogEmojis(), ...Object.keys(store.seen), ...Object.keys(store.moods)]);
  const pool: string[] = [];
  for (const e of all) {
    if (!isEnabled(e)) continue;
    if (effectiveMood(e) === mood) pool.push(e);
  }
  return pool;
}

function hasTrailingEmoji(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  const chunks = [...t.matchAll(EMOJI_CHUNK)].map((m) => m[0]);
  if (!chunks.length) return false;
  const lastChunk = chunks[chunks.length - 1]!;
  return t.endsWith(lastChunk) || t.endsWith(`${lastChunk} `);
}

/** Remove Kick chat tokens; they do not render on WhatsApp. */
export function stripKickEmoteTokens(text: string): string {
  return text.replace(/\[emote:\d+:[^\]]+\]/gi, " ").replace(/\s+/g, " ").trim();
}

export function maybeAppendWhatsAppEmoji(reply: string, hintText?: string): string {
  let out = stripKickEmoteTokens(reply);
  if (!out) return out;
  if (hasTrailingEmoji(out)) return out;

  let mood = inferMoodFromReply(out);
  if (!mood && hintText) mood = inferMoodFromReply(hintText);
  if (!mood) {
    if (Math.random() > 0.65) return out;
    const soft: EmoteMood[] = ["happy", "cool", "laugh", "hype", "neutral"];
    mood = soft[Math.floor(Math.random() * soft.length)]!;
  }

  const emoji = pickOne(moodPool(mood));
  if (!emoji) return out;
  return `${out} ${emoji}`.trim();
}

/** Final outgoing line for WhatsApp (strip Kick + mood emoji). */
export function formatWhatsAppOutgoing(reply: string, hintText?: string): string {
  return maybeAppendWhatsAppEmoji(stripKickEmoteTokens(reply), hintText);
}

export function whatsAppEmojiStats(): { learned: number; top: Array<{ emoji: string; count: number }> } {
  const store = getStore();
  const top = Object.entries(store.seen)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([emoji, count]) => ({ emoji, count }));
  return { learned: Object.keys(store.seen).length, top };
}

export type WhatsAppUiEmoji = {
  emoji: string;
  mood: EmoteMood;
  defaultMood: EmoteMood;
  source: "default" | "learned";
  count: number;
  enabled: boolean;
  changed: boolean;
};

/** Catalog + learned emoji with effective moods for the Emojis dashboard. */
export function listWhatsAppEmojisForUi(): WhatsAppUiEmoji[] {
  const store = getStore();
  const out: WhatsAppUiEmoji[] = [];
  const seen = new Set<string>();

  for (const emoji of catalogEmojis()) {
    seen.add(emoji);
    const def = defaultMoodFor(emoji) ?? "neutral";
    const mood = effectiveMood(emoji);
    out.push({
      emoji,
      mood,
      defaultMood: def,
      source: "default",
      count: store.seen[emoji] ?? 0,
      enabled: isEnabled(emoji),
      changed: Boolean(store.moods[emoji] && store.moods[emoji] !== def) || !isEnabled(emoji),
    });
  }

  const learnedKeys = new Set([...Object.keys(store.seen), ...Object.keys(store.moods)]);
  for (const emoji of learnedKeys) {
    if (seen.has(emoji)) continue;
    seen.add(emoji);
    const def = defaultMoodFor(emoji) ?? "neutral";
    const mood = effectiveMood(emoji);
    out.push({
      emoji,
      mood,
      defaultMood: def,
      source: "learned",
      count: store.seen[emoji] ?? 0,
      enabled: isEnabled(emoji),
      changed: Boolean(store.moods[emoji] && store.moods[emoji] !== def) || !isEnabled(emoji),
    });
  }

  return out.sort((a, b) => a.mood.localeCompare(b.mood) || a.emoji.localeCompare(b.emoji));
}

/**
 * Save mood + enabled flags from the dashboard.
 * `assignments`: emoji → mood. `enabled`: emoji → true/false.
 */
export function saveWhatsAppEmojiMoodsFromUi(
  assignments: Record<string, EmoteMood>,
  enabledMap?: Record<string, boolean>,
): number {
  const store = getStore();
  const nextMoods: Record<string, EmoteMood> = {};
  const known = new Set([...catalogEmojis(), ...Object.keys(store.seen), ...Object.keys(assignments)]);

  for (const emoji of known) {
    const chosen = assignments[emoji];
    if (!chosen || !isMood(chosen)) continue;
    const def = defaultMoodFor(emoji) ?? "neutral";
    if (chosen !== def) nextMoods[emoji] = chosen;
  }

  let nextDisabled = [...store.disabled];
  if (enabledMap) {
    for (const [emoji, on] of Object.entries(enabledMap)) {
      if (!emoji) continue;
      if (on) nextDisabled = nextDisabled.filter((x) => x !== emoji);
      else if (!nextDisabled.includes(emoji)) nextDisabled.push(emoji);
    }
  }

  store.moods = nextMoods;
  store.disabled = nextDisabled;
  writeStore(store);
  cache = store;
  return Object.keys(nextMoods).length + nextDisabled.length;
}
