import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CatalogMood } from "./kickEmoteCatalog.js";

const LEGACY_MOOD: Record<string, CatalogMood> = {
  shock: "surprise",
  cringe: "disgust",
  joy: "happy",
  welcome: "happy",
  leave: "sad",
  enter: "anticipation",
};

const MOODS: CatalogMood[] = [
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

export type StoredEmoteMood = CatalogMood;

const path = join(fileURLToPath(new URL(".", import.meta.url)), "../../data/emote-moods.json");

export type EmoteMoodOverrides = Record<string, StoredEmoteMood>;

let cache: EmoteMoodOverrides | null = null;

function isMood(value: unknown): value is StoredEmoteMood {
  return typeof value === "string" && (MOODS as string[]).includes(value);
}

function normalizeMood(value: unknown): StoredEmoteMood | null {
  if (typeof value !== "string") return null;
  const mapped = LEGACY_MOOD[value] ?? value;
  return isMood(mapped) ? mapped : null;
}

export function getEmoteMoodOverrides(): EmoteMoodOverrides {
  if (cache) return cache;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const out: EmoteMoodOverrides = {};
    for (const [name, mood] of Object.entries(raw ?? {})) {
      const m = normalizeMood(mood);
      if (m && name.trim()) out[name.trim()] = m;
    }
    cache = out;
    return out;
  } catch {
    cache = {};
    return cache;
  }
}

export function saveEmoteMoodOverrides(next: EmoteMoodOverrides): EmoteMoodOverrides {
  const clean: EmoteMoodOverrides = {};
  for (const [name, mood] of Object.entries(next)) {
    const key = name.trim();
    const m = normalizeMood(mood);
    if (!key || !m) continue;
    clean[key] = m;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(clean, null, 2));
  cache = clean;
  return clean;
}

export function reloadEmoteMoodOverrides(): EmoteMoodOverrides {
  cache = null;
  return getEmoteMoodOverrides();
}
