import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { envKey, reloadEnv } from "../config.js";
import { botFail, botThink, botWarn } from "../bot/activityLog.js";
import { detectLang } from "../bot/lang.js";
import { getVoicePrefs, type TtsVoiceId } from "./voicePrefs.js";

/** Build a WAV container around raw PCM s16le. */
export function pcmToWav(pcm: Buffer, sampleRate = 48_000, channels = 2, bitDepth = 16): Buffer {
  const header = Buffer.alloc(44);
  const dataSize = pcm.length;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * (bitDepth / 8), 28);
  header.writeUInt16LE(channels * (bitDepth / 8), 32);
  header.writeUInt16LE(bitDepth, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
}

/** Downmix stereo 48k PCM → mono 16k for smaller/faster Whisper uploads. */
export function downsamplePcm48kStereoTo16kMono(pcm: Buffer): Buffer {
  const inSamples = Math.floor(pcm.length / 2);
  const frames = Math.floor(inSamples / 2);
  const outFrames = Math.floor(frames / 3); // 48k → 16k
  const out = Buffer.alloc(outFrames * 2);
  for (let i = 0; i < outFrames; i++) {
    const frame = i * 3;
    const left = pcm.readInt16LE(frame * 4);
    const right = pcm.readInt16LE(frame * 4 + 2);
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round((left + right) / 2))), i * 2);
  }
  return out;
}

export function speechConfigured(): { stt: boolean; tts: boolean; sttProvider: string; ttsProvider: string } {
  reloadEnv();
  const groq = Boolean(envKey("GROQ_API_KEY"));
  const openai = Boolean(envKey("OPENAI_API_KEY"));
  const prefs = getVoicePrefs();
  return {
    stt: groq || openai,
    tts: true, // Edge TTS is free and always available
    sttProvider: groq ? "Groq Whisper (free)" : openai ? "OpenAI Whisper (paid)" : "none",
    ttsProvider: prefs.provider === "openai" ? "OpenAI TTS (paid)" : "Edge TTS (free)",
  };
}

function abortMessage(err: unknown, what: string, ms: number): string {
  const name = err instanceof Error ? err.name : "";
  const msg = err instanceof Error ? err.message : String(err);
  if (name === "AbortError" || /aborted|abort/i.test(msg)) {
    return `${what} timed out after ${Math.round(ms / 1000)}s`;
  }
  return `${what} fail: ${msg}`;
}

/** Speech → text. Always TR or EN (never auto-detect Russian etc.). */
export async function transcribeWav(wav: Buffer, languageHint?: "tr" | "en"): Promise<string | null> {
  reloadEnv();
  if (wav.length < 2000) return null;

  if (languageHint === "tr" || languageHint === "en") {
    return whisperAny(wav, languageHint);
  }

  const [tr, en] = await Promise.all([whisperAny(wav, "tr"), whisperAny(wav, "en")]);
  return pickTrOrEn(tr, en);
}

async function whisperAny(wav: Buffer, language: "tr" | "en"): Promise<string | null> {
  reloadEnv();
  const groq = envKey("GROQ_API_KEY");
  if (groq) {
    const text = await whisperOnce(
      "https://api.groq.com/openai/v1/audio/transcriptions",
      groq,
      "whisper-large-v3-turbo",
      wav,
      language,
    );
    if (text) return text;
  }
  const openai = envKey("OPENAI_API_KEY");
  if (openai) {
    return whisperOnce("https://api.openai.com/v1/audio/transcriptions", openai, "whisper-1", wav, language);
  }
  botWarn("voice", "No Groq/OpenAI key for speech-to-text");
  return null;
}

function pickTrOrEn(tr: string | null, en: string | null): string | null {
  const clean = (s: string | null) => {
    if (!s) return null;
    if (/[\u0400-\u04FF]/.test(s)) return null;
    return s;
  };
  const a = clean(tr);
  const b = clean(en);
  if (a && b) {
    const da = detectLang(a);
    const db = detectLang(b);
    if (da === "tr" && db !== "tr") return a;
    if (db === "en" && da !== "en") return b;
    if (/[çğıöşüÇĞİÖŞÜ]/.test(a) || da === "tr") return a;
    return b;
  }
  return a || b || clean(tr) || clean(en);
}

async function whisperOnce(
  url: string,
  key: string,
  model: string,
  wav: Buffer,
  languageHint?: "tr" | "en",
): Promise<string | null> {
  botThink("voice", `STT ${model} (${Math.round(wav.length / 1024)}KB)`);
  const tmp = join(tmpdir(), `camel-stt-${Date.now()}-${Math.random().toString(16).slice(2)}.wav`);
  const timeoutMs = 90_000;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    writeFileSync(tmp, wav);
    const bytes = new Uint8Array(wav);
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: "audio/wav" }), "utterance.wav");
    form.append("model", model);
    form.append("response_format", "json");
    if (languageHint === "tr" || languageHint === "en") form.append("language", languageHint);

    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: ac.signal,
    });
    if (!res.ok) {
      botWarn("voice", `STT HTTP ${res.status}: ${(await res.text()).slice(0, 180)}`);
      return null;
    }
    const json = (await res.json()) as { text?: string };
    const text = (json.text || "").replace(/\s+/g, " ").trim();
    return text || null;
  } catch (err) {
    botFail("voice", abortMessage(err, "STT", timeoutMs));
    return null;
  } finally {
    clearTimeout(timer);
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

export type SynthesizeOpts = {
  lang?: "tr" | "en" | "other";
  voice?: TtsVoiceId | string;
  model?: "tts-1" | "tts-1-hd";
  /** Use this voice even if it doesn't match lang (user named Ahmet / Jenny / …). */
  forceVoice?: boolean;
};

const OPENAI_IDS = new Set([
  "alloy",
  "ash",
  "coral",
  "echo",
  "fable",
  "nova",
  "onyx",
  "sage",
  "shimmer",
]);

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function pickEdgeVoice(lang?: "tr" | "en" | "other", preferred?: string, forcePreferred = false): string {
  if (forcePreferred && preferred && preferred.includes("-") && /Neural$/i.test(preferred)) {
    return preferred;
  }
  if (lang === "en") {
    if (preferred && /^en-/i.test(preferred) && /Neural$/i.test(preferred)) return preferred;
    return "en-US-GuyNeural";
  }
  if (lang === "tr") {
    if (preferred && /^tr-/i.test(preferred) && /Neural$/i.test(preferred)) return preferred;
    return "tr-TR-AhmetNeural";
  }
  if (preferred && preferred.includes("-") && /Neural$/i.test(preferred)) return preferred;
  return "tr-TR-AhmetNeural";
}

async function synthesizeEdge(text: string, voiceName: string): Promise<Buffer | null> {
  botThink("voice", `TTS Edge/${voiceName} (${text.length} chars)`);
  try {
    const { MsEdgeTTS, OUTPUT_FORMAT } = await import("msedge-tts");
    const tts = new MsEdgeTTS();
    await tts.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(escapeXml(text));
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Edge TTS timed out")), 60_000);
      audioStream.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
      audioStream.on("end", () => {
        clearTimeout(timer);
        resolve();
      });
      audioStream.on("error", (err: Error) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    const buf = Buffer.concat(chunks);
    if (!buf.length) {
      botWarn("voice", "Edge TTS returned empty audio");
      return null;
    }
    return buf;
  } catch (err) {
    botFail("voice", `Edge TTS fail: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function synthesizeOpenAi(text: string, voice: string, model: "tts-1" | "tts-1-hd"): Promise<Buffer | null> {
  reloadEnv();
  const key = envKey("OPENAI_API_KEY");
  if (!key) {
    botWarn("voice", "No OPENAI_API_KEY for paid TTS");
    return null;
  }
  botThink("voice", `TTS OpenAI ${model}/${voice} (${text.length} chars)`);
  const timeoutMs = 90_000;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        voice,
        input: text,
        response_format: "mp3",
      }),
      signal: ac.signal,
    });
    if (!res.ok) {
      botWarn("voice", `OpenAI TTS HTTP ${res.status}: ${(await res.text()).slice(0, 180)}`);
      return null;
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    botFail("voice", abortMessage(err, "OpenAI TTS", timeoutMs));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Strip RP *actions*, Kick emote tags, and markdown so TTS only speaks real words. */
export function cleanTextForTts(text: string): string {
  return text
    .replace(/\[emote:\d+:[^\]]*\]/gi, " ")
    .replace(/\[[^\]]*emote[^\]]*\]/gi, " ")
    .replace(/\*[^*]+\*/g, " ")
    .replace(/_(?!\s)([^_]+)_(?!\w)/g, " ")
    .replace(/[`~]/g, " ")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Text → speech (mp3). Default: free Edge TTS. Auto-picks TR/EN Edge voice from lang. */
export async function synthesizeSpeech(text: string, opts?: SynthesizeOpts): Promise<Buffer | null> {
  const clipped = cleanTextForTts(text).slice(0, 900);
  if (!clipped) return null;
  const prefs = getVoicePrefs();
  const voice = String(opts?.voice ?? prefs.voice);
  const forceVoice = Boolean(opts?.forceVoice && opts?.voice);
  const wantOpenAi = !forceVoice && (OPENAI_IDS.has(voice) || prefs.provider === "openai");

  if (forceVoice && OPENAI_IDS.has(voice)) {
    const audio = await synthesizeOpenAi(clipped, voice, opts?.model ?? prefs.model);
    if (audio) return audio;
    botWarn("voice", "OpenAI TTS unavailable — using free Edge voice");
    return synthesizeEdge(clipped, pickEdgeVoice(opts?.lang));
  }

  if (forceVoice && voice.includes("-") && /Neural$/i.test(voice)) {
    return synthesizeEdge(clipped, voice);
  }

  // Auto: match language to an Edge neural voice (don't keep TR Ahmet on English lines).
  if (opts?.lang === "en" || opts?.lang === "tr") {
    return synthesizeEdge(clipped, pickEdgeVoice(opts.lang, voice, false));
  }

  if (wantOpenAi && OPENAI_IDS.has(voice)) {
    const audio = await synthesizeOpenAi(clipped, voice, opts?.model ?? prefs.model);
    if (audio) return audio;
    botWarn("voice", "OpenAI TTS unavailable (credits?) — using free Edge voice");
    return synthesizeEdge(clipped, pickEdgeVoice(opts?.lang));
  }

  return synthesizeEdge(clipped, pickEdgeVoice(opts?.lang, voice, false));
}
