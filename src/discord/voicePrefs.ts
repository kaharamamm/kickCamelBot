import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const path = join(fileURLToPath(new URL(".", import.meta.url)), "../../data/voice.json");

/** Free Microsoft Edge neural voices (no API key / no credits). */
export const EDGE_TTS_VOICES = [
  { id: "tr-TR-AhmetNeural", label: "Ahmet (TR, free)", provider: "edge" as const },
  { id: "tr-TR-EmelNeural", label: "Emel (TR, free)", provider: "edge" as const },
  { id: "en-US-GuyNeural", label: "Guy (EN, free)", provider: "edge" as const },
  { id: "en-US-JennyNeural", label: "Jenny (EN, free)", provider: "edge" as const },
  { id: "en-US-AriaNeural", label: "Aria (EN, free)", provider: "edge" as const },
  { id: "en-GB-RyanNeural", label: "Ryan (EN-GB, free)", provider: "edge" as const },
  { id: "en-GB-SoniaNeural", label: "Sonia (EN-GB, free)", provider: "edge" as const },
] as const;

/** OpenAI voices — need OPENAI_API_KEY with billed credits. */
export const OPENAI_TTS_VOICES = [
  { id: "alloy", label: "Alloy (OpenAI, paid)", provider: "openai" as const },
  { id: "ash", label: "Ash (OpenAI, paid)", provider: "openai" as const },
  { id: "coral", label: "Coral (OpenAI, paid)", provider: "openai" as const },
  { id: "echo", label: "Echo (OpenAI, paid)", provider: "openai" as const },
  { id: "fable", label: "Fable (OpenAI, paid)", provider: "openai" as const },
  { id: "nova", label: "Nova (OpenAI, paid)", provider: "openai" as const },
  { id: "onyx", label: "Onyx (OpenAI, paid)", provider: "openai" as const },
  { id: "sage", label: "Sage (OpenAI, paid)", provider: "openai" as const },
  { id: "shimmer", label: "Shimmer (OpenAI, paid)", provider: "openai" as const },
] as const;

export const ALL_TTS_VOICES = [...EDGE_TTS_VOICES, ...OPENAI_TTS_VOICES];

export type TtsProvider = "edge" | "openai";
export type EdgeTtsVoice = (typeof EDGE_TTS_VOICES)[number]["id"];
export type OpenAiTtsVoice = (typeof OPENAI_TTS_VOICES)[number]["id"];
export type TtsVoiceId = EdgeTtsVoice | OpenAiTtsVoice;

export type VoicePrefs = {
  provider: TtsProvider;
  voice: TtsVoiceId;
  model: "tts-1" | "tts-1-hd";
};

const DEFAULTS: VoicePrefs = {
  provider: "edge",
  voice: "tr-TR-AhmetNeural",
  model: "tts-1",
};

let cache: VoicePrefs | null = null;

function findVoice(id: string): (typeof ALL_TTS_VOICES)[number] | undefined {
  return ALL_TTS_VOICES.find((v) => v.id === id);
}

export function listTtsVoices(): Array<{ id: string; label: string; provider: TtsProvider }> {
  return ALL_TTS_VOICES.map((v) => ({ id: v.id, label: v.label, provider: v.provider }));
}

export function getVoicePrefs(): VoicePrefs {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<VoicePrefs> & { voice?: string };
    // Migrate old OpenAI-only defaults (nova) to free Edge — OpenAI needs billed credits.
    if (!parsed.provider && (!parsed.voice || parsed.voice === "nova" || parsed.voice === "onyx")) {
      cache = { ...DEFAULTS };
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(cache, null, 2));
      return cache;
    }
    const known = parsed.voice ? findVoice(parsed.voice) : undefined;
    if (known) {
      cache = {
        provider: known.provider,
        voice: known.id,
        model: parsed.model === "tts-1-hd" ? "tts-1-hd" : "tts-1",
      };
    } else {
      cache = { ...DEFAULTS };
    }
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

export function saveVoicePrefs(next: Partial<VoicePrefs> & { voice?: string }): VoicePrefs {
  const cur = getVoicePrefs();
  const known = next.voice ? findVoice(next.voice) : findVoice(cur.voice);
  const model = next.model === "tts-1-hd" ? "tts-1-hd" : next.model === "tts-1" ? "tts-1" : cur.model;
  cache = {
    provider: known?.provider ?? cur.provider,
    voice: (known?.id as TtsVoiceId) ?? cur.voice,
    model,
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cache, null, 2));
  return cache;
}
