import {
  AudioPlayerStatus,
  EndBehaviorType,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
  type AudioPlayer,
  type VoiceConnection,
} from "@discordjs/voice";
import {
  ChannelType,
  type Client,
  type GuildMember,
  type Message,
  type VoiceBasedChannel,
} from "discord.js";
import { createWriteStream, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import prism from "prism-media";
import ffmpegStatic from "ffmpeg-static";
import sodium from "libsodium-wrappers";
import "@snazzah/davey";
import { botFail, botOk, botThink, botWarn } from "../bot/activityLog.js";
import { asksAboutStreamer, busyFallback, calledTheBot, calledTheMods, rememberExchange, replyWithAi, shouldTalkToAi } from "../bot/ai.js";
import { detectLang } from "../bot/lang.js";
import { noteExchange, rememberPerson } from "../bot/memory.js";
import { enqueueWork } from "../bot/workQueue.js";
import { rememberThread, stillTalkingToUs } from "../bot/conversation.js";
import {
  discordDisplayName,
  discordUserKey,
  ensureDiscordMemory,
  isDiscordKing,
} from "./identities.js";
import { alwaysReplyUserIds, getDiscordRouting } from "./settings.js";
import { tryDiscordStaffFromVoice } from "./staff.js";
import {
  downsamplePcm48kStereoTo16kMono,
  pcmToWav,
  speechConfigured,
  synthesizeSpeech,
  cleanTextForTts,
  transcribeWav,
} from "./speech.js";
import { getVoicePrefs } from "./voicePrefs.js";
import { getLastBotLine, rememberSpoken } from "./speechMemory.js";

const ffmpegPath = typeof ffmpegStatic === "string" ? ffmpegStatic : null;
if (ffmpegPath) {
  process.env.FFMPEG_PATH = ffmpegPath;
  process.env.FFMPEG_BIN = ffmpegPath;
}

let sodiumReady: Promise<void> | null = null;

async function ensureSodium(): Promise<void> {
  if (!sodiumReady) {
    sodiumReady = sodium.ready.then(() => undefined);
  }
  await sodiumReady;
}

type Session = {
  guildId: string;
  voiceChannelId: string;
  textChannelId: string;
  connection: VoiceConnection;
  player: AudioPlayer;
  speaking: boolean;
  /** When true, ignore chat/voice except unmute / start-listening orders. */
  listenPaused: boolean;
  listening: Set<string>;
  client: Client;
};

const sessions = new Map<string, Session>();
/** Bumped to cancel in-flight TTS playback. */
const speakEpoch = new Map<string, number>();

export function isShutUpRequest(content: string): boolean {
  if (isBotSelfMuteRequest(content) || isBotSelfUnmuteRequest(content)) return false;
  const t = content
    .toLocaleLowerCase("tr")
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  if (!t || t.length > 100) return false;
  if (
    /\b(?:shut\s*up|be\s*quiet|stop\s*talking|stop\s*speaking|that's\s*enough|thats\s*enough|that\s+is\s+enough)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  if (/^stop(?:\s+please)?[.!?]*$/i.test(t)) return true;
  if (/^(?:tamam\s+)?(?:yeter|yeterli)(?:\s+art[ıi]k)?[.!?]*$/i.test(t)) return true;
  if (/\b(?:yeter\s+art[ıi]k|kapa\s+çeneni|kapa\s+ceneni)\b/i.test(t)) return true;
  if (/^(?:ok(?:ay)?[,.]?\s*)?(?:that's|thats)\s+enough\b/i.test(t)) return true;
  if (/^(?:ok(?:ay)?|tamam)[,.]?\s*(?:good|güzel|guzel)[.!?]*$/i.test(t)) return true;
  if (/^enough[.!?]*$/i.test(t)) return true;
  return false;
}

/** Mute the bot / stop listening to the call (not mute another user). */
export function isBotSelfMuteRequest(content: string): boolean {
  const t = content
    .toLocaleLowerCase("tr")
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  if (!t || t.length > 160) return false;
  if (/@\d{15,22}/.test(content) || /<@!?\d+>/.test(content)) return false;
  if (/\b(?:mute|sustur)\b/.test(t) && /\b(?:him|her|them|onu|onlari|onları|@)\b/.test(t)) return false;

  if (/^(?:(?:hey\s+)?(?:camelbot|camel|bot)\s*[,:]?\s*)?(?:mute(?:\s+yourself)?|stop\s+listening|don't\s+listen|do\s+not\s+listen)[.!?]*$/i.test(t)) {
    return true;
  }
  if (/\b(?:mute\s+yourself|mute\s+(?:the\s+)?bot|bot\s*,?\s*mute|stop\s+listening|don't\s+listen|do\s+not\s+listen)\b/i.test(t)) {
    return true;
  }
  if (/\b(?:mikrofonu?\s*(?:nu\s*)?kapa|kendini\s*mute|kendine\s*mute|kendini\s*sustur|sustur\s*kendini)\b/i.test(t)) {
    return true;
  }
  if (/\b(?:dinleme(?:\s+art[ıi]k)?|dinlemeyi\s*birak|dinlemeyi\s*bırak|art[ıi]k\s*dinleme)\b/i.test(t)) {
    return true;
  }
  if (/^(?:(?:hey\s+)?(?:camelbot|camel|bot)\s*[,:]?\s*)?(?:sus|kes)(?:\s+art[ıi]k)?[.!?]*$/i.test(t)) return true;
  if (/\b(?:tamam\s+)?(?:sus|kes)(?:\s+art[ıi]k)?\b/i.test(t) && t.length < 40) return true;
  if (/\b(?:kes\s+sesini|sus\s+art[ıi]k)\b/i.test(t)) return true;
  return false;
}

/** Unmute the bot / start listening again. */
export function isBotSelfUnmuteRequest(content: string): boolean {
  const t = content
    .toLocaleLowerCase("tr")
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  if (!t || t.length > 160) return false;
  if (/@\d{15,22}/.test(content) || /<@!?\d+>/.test(content)) return false;

  if (/^(?:(?:hey\s+)?(?:camelbot|camel|bot)\s*[,:]?\s*)?(?:unmute(?:\s+yourself)?|start\s+listening|listen(?:\s+again)?)[.!?]*$/i.test(t)) {
    return true;
  }
  if (/\b(?:unmute\s+yourself|unmute\s+(?:the\s+)?bot|bot\s*,?\s*unmute|start\s+listening|listen\s+again)\b/i.test(t)) {
    return true;
  }
  if (/\b(?:mikrofonu?\s*(?:nu\s*)?a[cç]|kendini\s*unmute|kendine\s*unmute)\b/i.test(t)) return true;
  if (/^(?:(?:hey\s+)?(?:camelbot|camel|bot)\s*[,:]?\s*)?(?:dinle)[.!?]*$/i.test(t)) return true;
  if (/\b(?:dinlemeye\s*basla|dinlemeye\s*başla|tekrar\s*dinle|art[ıi]k\s*dinle)\b/i.test(t)) return true;
  return false;
}

export function isListenPaused(guildId: string): boolean {
  return Boolean(sessions.get(guildId)?.listenPaused);
}

/** Pause STT replies in this guild's voice session (bot stays in channel). */
export function setBotListening(guildId: string, listening: boolean): boolean {
  const session = sessions.get(guildId);
  if (!session) return false;
  session.listenPaused = !listening;
  if (!listening) stopSpeaking(guildId);
  void applyDiscordSelfMute(session, !listening);
  botOk("voice", listening ? "Listening again" : "Muted self / stopped listening");
  return true;
}

async function applyDiscordSelfMute(session: Session, muted: boolean): Promise<void> {
  // Stay subscribed to audio so "unmute" / "dinle" still works over voice.
  // Only mark selfMute for UI; conversation handling is gated by listenPaused.
  try {
    session.connection.joinConfig.selfMute = muted;
  } catch {
    /* ignore */
  }
  void session;
}

export function tryBotSelfListenControl(
  guildId: string | null | undefined,
  content: string,
): { handled: true; listening: boolean } | { handled: false } {
  if (!guildId || !sessions.has(guildId)) return { handled: false };
  if (isBotSelfUnmuteRequest(content)) {
    setBotListening(guildId, true);
    return { handled: true, listening: true };
  }
  if (isBotSelfMuteRequest(content)) {
    setBotListening(guildId, false);
    return { handled: true, listening: false };
  }
  return { handled: false };
}

/** Stop Discord TTS immediately (no chat reply). Returns true if something was stopped. */
export function stopSpeaking(guildId?: string): boolean {
  const ids = guildId ? [guildId] : [...sessions.keys()];
  let stopped = false;
  for (const id of ids) {
    const session = sessions.get(id);
    if (!session) continue;
    speakEpoch.set(id, (speakEpoch.get(id) ?? 0) + 1);
    if (session.speaking || session.player.state.status !== AudioPlayerStatus.Idle) {
      try {
        session.player.stop(true);
      } catch {
        /* ignore */
      }
      session.speaking = false;
      stopped = true;
      botOk("voice", "Stopped speaking (shut up)");
    }
  }
  return stopped;
}

export function isBotSpeaking(guildId?: string): boolean {
  if (guildId) return Boolean(sessions.get(guildId)?.speaking);
  for (const s of sessions.values()) if (s.speaking) return true;
  return false;
}

export function voiceStatus(): {
  configured: { stt: boolean; tts: boolean; sttProvider: string; ttsProvider: string };
  prefs: ReturnType<typeof getVoicePrefs>;
  sessions: Array<{ guildId: string; voiceChannelId: string; textChannelId: string }>;
} {
  return {
    configured: speechConfigured(),
    prefs: getVoicePrefs(),
    sessions: [...sessions.values()].map((s) => ({
      guildId: s.guildId,
      voiceChannelId: s.voiceChannelId,
      textChannelId: s.textChannelId,
    })),
  };
}

export async function handleVoiceCommand(message: Message): Promise<boolean> {
  const text = message.content.trim();
  const m = text.match(/^!voice(?:\s+(join|leave|status))?$/i);
  if (!m) return false;

  const action = (m[1] || "status").toLowerCase();
  if (action === "status") {
    const cfg = speechConfigured();
    const prefs = getVoicePrefs();
    const session = message.guildId ? sessions.get(message.guildId) : undefined;
    await message.reply({
      content: [
        `Voice STT: ${cfg.stt ? cfg.sttProvider : "missing GROQ_API_KEY (free Whisper)"}`,
        `Voice TTS: ${cfg.ttsProvider} · ${prefs.voice}`,
        session
          ? `In voice: <#${session.voiceChannelId}> (joined from <#${session.textChannelId}>)${session.listenPaused ? " · muted/not listening" : ""}`
          : "Not in a voice channel here. Use `!voice join` or Dashboard → Discord → Voice.",
        "Say **camel** / **camelbot** / **bot**, then talk. Mute me with **sus** / **mute** / **dinleme**; unmute with **dinle** / **unmute**.",
      ].join("\n"),
    });
    return true;
  }

  if (!message.guild || !message.member) {
    await message.reply({ content: "Voice only works inside a server." });
    return true;
  }

  if (action === "leave") {
    await leaveVoice(message.guild.id);
    await message.reply({ content: "Left voice." });
    return true;
  }

  const channel = message.member.voice.channel;
  if (!channel || (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice)) {
    await message.reply({ content: "Join a voice channel first, then `!voice join`." });
    return true;
  }

  const cfg = speechConfigured();
  if (!cfg.stt) {
    await message.reply({
      content: "Speech-to-text needs `GROQ_API_KEY` or `OPENAI_API_KEY` in `.env`.",
    });
    return true;
  }

  try {
    await joinVoice(message.client, channel, message.channelId);
    await message.reply({
      content: [
        `Joined **${channel.name}**.`,
        `I'll listen (${cfg.sttProvider}) and speak back (${getVoicePrefs().voice} / ${cfg.ttsProvider}).`,
        "Start with **camel** / **camelbot** / **bot**. Say **sus** / **dinleme** to mute me; **dinle** / **unmute** to listen again.",
      ].join(" "),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    botFail("voice", msg);
    await message.reply({ content: `Couldn't join voice: ${msg}` });
  }
  return true;
}

export async function joinVoiceByIds(
  client: Client,
  guildId: string,
  voiceChannelId: string,
  textChannelId?: string,
): Promise<{ ok: true; channelName: string } | { ok: false; error: string }> {
  try {
    const guild = await client.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(voiceChannelId);
    if (!channel || (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice)) {
      return { ok: false, error: "Pick a voice channel." };
    }
    const textId =
      textChannelId?.trim() ||
      getDiscordRouting().routes.find((r) => r.guildId === guildId)?.listenChannelId ||
      voiceChannelId;
    await joinVoice(client, channel, textId);
    return { ok: true, channelName: channel.name };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    botFail("voice", msg);
    return { ok: false, error: msg };
  }
}

export async function joinVoice(client: Client, channel: VoiceBasedChannel, textChannelId: string): Promise<void> {
  await ensureSodium();
  const guildId = channel.guild.id;
  await leaveVoice(guildId);

  const me = channel.guild.members.me;
  if (me) {
    const perms = channel.permissionsFor(me);
    if (!perms?.has("Connect")) {
      throw new Error("Bot needs Connect permission in that voice channel (re-invite with Connect + Speak).");
    }
    if (!perms?.has("Speak")) {
      throw new Error("Bot needs Speak permission in that voice channel (re-invite with Connect + Speak).");
    }
  }

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: false,
  });

  connection.on("stateChange", (oldState, newState) => {
    if (oldState.status === newState.status) return;
    botThink("voice", `conn ${oldState.status} → ${newState.status}`);
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
  } catch (err) {
    const close =
      connection.state.status === VoiceConnectionStatus.Disconnected
        ? String((connection.state as { closeCode?: number }).closeCode ?? "")
        : "";
    connection.destroy();
    const msg = err instanceof Error ? err.message : String(err);
    if (/abort/i.test(msg) || close === "4017") {
      throw new Error(
        "Voice connection timed out (Discord DAVE encryption). Re-invite with Connect+Speak, restart the bot, and use Node 22+ if this keeps failing.",
      );
    }
    throw err instanceof Error ? err : new Error(String(err));
  }

  const player = createAudioPlayer();
  connection.subscribe(player);

  const session: Session = {
    guildId,
    voiceChannelId: channel.id,
    textChannelId,
    connection,
    player,
    speaking: false,
    listenPaused: false,
    listening: new Set(),
    client,
  };
  sessions.set(guildId, session);

  connection.on("stateChange", (_old, next) => {
    if (next.status === VoiceConnectionStatus.Destroyed) {
      sessions.delete(guildId);
      return;
    }
    if (next.status === VoiceConnectionStatus.Disconnected) {
      try {
        connection.destroy();
      } catch {
        /* ignore */
      }
      sessions.delete(guildId);
    }
  });

  connection.receiver.speaking.on("start", (userId) => {
    void startListening(client, session, userId).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/premature close|aborted/i.test(msg)) botWarn("voice", msg);
    });
  });

  botOk("voice", `Joined ${channel.name} (${channel.id})`);
}

export async function leaveVoice(guildId?: string): Promise<void> {
  if (guildId) {
    const session = sessions.get(guildId);
    if (session) {
      session.connection.destroy();
      sessions.delete(guildId);
    } else {
      getVoiceConnection(guildId)?.destroy();
    }
    return;
  }
  for (const id of [...sessions.keys()]) {
    await leaveVoice(id);
  }
}

/** True when the user asked for a spoken/voice reply (e.g. "sesli", "out loud", "say this"). */
export function wantsVoiceReply(content: string): boolean {
  const t = content.toLocaleLowerCase("tr");
  return (
    /\bsesli\b/i.test(content) ||
    /\bsesle\b/i.test(content) ||
    /sesli\s*(söyle|soyle|oku|cevapla|yanıtla|yanitla|anlat|der\s+misin)/i.test(t) ||
    /(söyle|soyle|oku|cevapla|yanıtla|yanitla|anlat|der\s+misin).{0,24}sesli/i.test(t) ||
    /\bsay\s+this\b/i.test(content) ||
    /\bspeak\s+this\b/i.test(content) ||
    /şunu\s+söyle|sunu\s+soyle/i.test(t) ||
    /\bout\s+loud\b/i.test(t) ||
    /\baloud\b/i.test(t) ||
    /\bin\s+voice\b/i.test(t) ||
    /\bverbally\b/i.test(t) ||
    /\bspeak\s+it\b/i.test(t) ||
    /\bsay\s+it\s+(out\s+loud|in\s+voice|aloud|on\s+(the\s+)?mic)\b/i.test(t) ||
    /\b(voice|spoken)\s+reply\b/i.test(t) ||
    /\bread\s+(it\s+)?(out\s+loud|aloud)\b/i.test(t) ||
    /mikrofon(dan|la)|mic(?:'|\s)?ten|\bon\s+(the\s+)?mic\b/i.test(t)
  );
}

const VOICE_ALIASES: Array<{ re: RegExp; id: string }> = [
  { re: /\bahmet\b/i, id: "tr-TR-AhmetNeural" },
  { re: /\bemel\b/i, id: "tr-TR-EmelNeural" },
  { re: /\bguy\b/i, id: "en-US-GuyNeural" },
  { re: /\bjenny\b/i, id: "en-US-JennyNeural" },
  { re: /\baria\b/i, id: "en-US-AriaNeural" },
  { re: /\bryan\b/i, id: "en-GB-RyanNeural" },
  { re: /\bsonia\b/i, id: "en-GB-SoniaNeural" },
  { re: /\balloy\b/i, id: "alloy" },
  { re: /\bash\b/i, id: "ash" },
  { re: /\bcoral\b/i, id: "coral" },
  { re: /\becho\b/i, id: "echo" },
  { re: /\bfable\b/i, id: "fable" },
  { re: /\bnova\b/i, id: "nova" },
  { re: /\bonyx\b/i, id: "onyx" },
  { re: /\bsage\b/i, id: "sage" },
  { re: /\bshimmer\b/i, id: "shimmer" },
];

export type SpeakDirective = {
  wantsSpeak: boolean;
  /** Exact words to speak when they quoted a phrase / “say this”. */
  phrase?: string;
  /** Speak the quote directly (skip AI). */
  directSay: boolean;
  lang?: "tr" | "en" | "other";
  voice?: string;
  forceVoice: boolean;
};

/** Parse sesli / say-this / “in tr ahmet” style voice instructions from a Discord message. */
export function parseSpeakDirective(content: string): SpeakDirective {
  const wantsSpeak = wantsVoiceReply(content);
  let lang: "tr" | "en" | "other" | undefined;
  if (/\b(?:in\s+)?(?:tr|turkish|türkçe|turkce)\b/i.test(content)) lang = "tr";
  else if (/\b(?:in\s+)?(?:en|english|ingilizce)\b/i.test(content)) lang = "en";

  let voice: string | undefined;
  const fullId = content.match(/\b((?:tr|en)-(?:TR|US|GB)-[A-Za-z]+Neural)\b/);
  if (fullId) {
    voice = fullId[1];
  } else {
    for (const row of VOICE_ALIASES) {
      if (row.re.test(content)) {
        voice = row.id;
        break;
      }
    }
  }

  const quoted =
    content.match(/["“”]([^"“”]{1,400})["“”]/)?.[1]?.trim() ||
    content.match(/['‘’]([^'‘’]{1,400})['‘’]/)?.[1]?.trim();

  const sayThis =
    content.match(/\bsay\s+this\s*[:：]\s*(.+)$/i)?.[1]?.trim() ||
    content.match(/\bspeak\s+this\s*[:：]\s*(.+)$/i)?.[1]?.trim() ||
    content.match(/şunu\s+söyle\s*[:：]?\s*(.+)$/i)?.[1]?.trim();

  let phrase = quoted;
  if (!phrase && sayThis) {
    phrase = sayThis
      .replace(/\s*\((?:tr|en|turkish|english|türkçe|turkce|ingilizce)[^)]*\)\s*$/i, "")
      .replace(/\s+in\s+(?:tr|en|turkish|english|türkçe|turkce|ingilizce)\b.*$/i, "")
      .replace(/\s+\b(?:ahmet|emel|guy|jenny|aria|ryan|sonia)\b\s*$/i, "")
      .replace(/^["“”'‘’]|["“”'‘’]$/g, "")
      .trim();
  }

  const directSay = Boolean(
    phrase &&
      (/\bsay\s+this\b/i.test(content) ||
        /\bspeak\s+this\b/i.test(content) ||
        /şunu\s+söyle|sunu\s+soyle/i.test(content) ||
        /(?:söyle|soyle|der\s+misin|oku)\b/i.test(content)),
  );

  return {
    wantsSpeak: wantsSpeak || directSay,
    phrase,
    directSay,
    lang,
    voice,
    forceVoice: Boolean(voice),
  };
}

export function isInVoiceGuild(guildId: string): boolean {
  return sessions.has(guildId);
}

/** Speak a line in the current Discord voice session (text→voice or dashboard test). */
export async function speakInGuild(
  guildId: string,
  text: string,
  opts?: { lang?: "tr" | "en" | "other"; voice?: string; forceVoice?: boolean; userKey?: number },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = sessions.get(guildId);
  if (!session) return { ok: false, error: "Bot is not in a voice channel — use !voice join first." };
  const cleaned = stripForSpeech(text);
  const audio = await synthesizeSpeech(cleaned, {
    lang: opts?.lang,
    voice: opts?.voice,
    forceVoice: opts?.forceVoice,
  });
  if (!audio) return { ok: false, error: "TTS failed." };
  await playMp3(session, audio);
  rememberSpoken(guildId, cleaned, opts?.userKey);
  return { ok: true };
}

async function startListening(client: Client, session: Session, userId: string): Promise<void> {
  if (session.speaking) return;
  if (session.listening.has(userId)) return;
  if (userId === client.user?.id) return;

  session.listening.add(userId);
  try {
    const opus = session.connection.receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: 1_400 },
    });
    const decoder = new prism.opus.Decoder({ frameSize: 960, channels: 2, rate: 48_000 });
    const chunks: Buffer[] = [];
    decoder.on("data", (chunk: Buffer) => chunks.push(chunk));

    await pipeline(opus, decoder).catch(() => undefined);

    const pcm = Buffer.concat(chunks);
    if (pcm.length < 48_000) return; // ~0.5s of stereo 48k

    const mono16k = downsamplePcm48kStereoTo16kMono(pcm);
    const wav = pcmToWav(mono16k, 16_000, 1);
    await enqueueWork(`discord-voice:${session.guildId}`, () =>
      handleUtterance(client, session, userId, wav),
    );
  } finally {
    session.listening.delete(userId);
  }
}

async function handleUtterance(client: Client, session: Session, userId: string, wav: Buffer): Promise<void> {
  if (session.speaking) return;

  const guild = await client.guilds.fetch(session.guildId).catch(() => null);
  const member = (await guild?.members.fetch(userId).catch(() => null)) as GuildMember | null;
  const liveName = member?.displayName || member?.user.username || userId;
  const who = discordDisplayName(userId, liveName);
  ensureDiscordMemory(userId);

  const transcript = await transcribeWav(wav);
  if (!transcript || transcript.length < 2) return;

  botThink("voice", `${who}: ${transcript.slice(0, 120)}`);
  console.log(`[discord-voice] ${who}: ${transcript.slice(0, 100)}`);

  const cleanedWake =
    transcript.replace(/^\s*(?:hey\s+)?(?:camelbot|camel|bot)\s*[,:]?\s*/i, "").trim() || transcript;

  // Unmute / mute-self always work, even while listening is paused.
  let selfCtrl = tryBotSelfListenControl(session.guildId, cleanedWake);
  if (!selfCtrl.handled) selfCtrl = tryBotSelfListenControl(session.guildId, transcript);
  if (selfCtrl.handled) {
    rememberThread(session.guildId, userId);
    return;
  }
  if (session.listenPaused) return;

  const fromKing = isDiscordKing(userId, member?.user.username ?? "", member?.displayName);
  const always = alwaysReplyUserIds(getDiscordRouting()).includes(userId);
  const wake = /\bcamel(?:bot)?\b/i.test(transcript) || shouldTalkToAi(transcript) || calledTheBot(transcript);
  const roomId = session.guildId;
  const continuing = stillTalkingToUs(roomId, userId, transcript, undefined, false);

  if (!always && !wake && !continuing) return;
  if (!wake && !continuing && transcript.length < 10 && !/[?؟]/.test(transcript)) return;

  const cleaned =
    transcript.replace(/^\s*(?:hey\s+)?(?:camelbot|camel)\s*[,:]?\s*/i, "").trim() || transcript;

  const userKey = discordUserKey(userId);
  let lang = detectLang(cleaned, userKey);
  if (lang === "other") lang = /[çğıöşüÇĞİÖŞÜ]/.test(cleaned) ? "tr" : "en";

  if (isShutUpRequest(cleaned)) {
    stopSpeaking(session.guildId);
    return;
  }

  if (guild && member) {
    const staff = await tryDiscordStaffFromVoice(guild, member, cleaned, {
      lang,
      fromKing,
      textChannelId: session.textChannelId,
    });
    if (staff.handled) {
      rememberPerson({ user_id: userKey, username: who }, cleaned);
      noteExchange(userKey, who, cleaned, staff.text || "ok");
      if (staff.text) {
        rememberExchange(userKey, cleaned, `[voice] ${staff.text}`);
        const audio = await synthesizeSpeech(staff.text, { lang });
        if (audio) {
          await playMp3(session, audio);
          rememberSpoken(session.guildId, staff.text, userKey);
        }
      }
      rememberThread(roomId, userId);
      if (staff.ok) botOk("voice", "Staff order");
      else if (staff.text) botFail("voice", staff.text);
      return;
    }
  }

  // “aynı şeyi söyle / tekrar et” in the call → replay last spoken line
  if (
    /ayni\s+sey|aynı\s+şey|tekrar\s+et|bir\s+daha\s+söyle|say\s+it\s+again|repeat\s+that/i.test(cleaned) ||
    /sesli(?:de)?.{0,40}tekrar|söylediğini\s+tekrar/i.test(cleaned)
  ) {
    const prior = getLastBotLine(session.guildId, userKey);
    if (prior) {
      const audio = await synthesizeSpeech(prior, { lang: detectLang(prior, userKey) });
      if (audio) {
        await playMp3(session, audio);
        rememberSpoken(session.guildId, prior, userKey);
        rememberExchange(userKey, cleaned, `[voice] ${prior}`);
        rememberThread(roomId, userId);
        botOk("voice", `Repeated: ${prior.slice(0, 80)}`);
        return;
      }
    }
  }

  let line: string;
  try {
    const reply = await replyWithAi(
      { sender: { user_id: userKey, username: who }, content: cleaned },
      {
        force: true,
        continuing: true,
        lang,
        fromKing,
        allowKing: fromKing || asksAboutStreamer(cleaned),
        calledBot: calledTheBot(cleaned) && !fromKing,
        calledMods: calledTheMods(cleaned),
        voiceReply: true,
        lastSpoken: getLastBotLine(session.guildId, userKey),
      },
    );
    line = reply || busyFallback(lang);
  } catch (err) {
    botFail("voice", err instanceof Error ? err.message : String(err));
    line = busyFallback(lang);
  }

  rememberPerson({ user_id: userKey, username: who }, cleaned);
  noteExchange(userKey, who, cleaned, line);
  rememberExchange(userKey, cleaned, line);

  const speakDir = parseSpeakDirective(cleaned);
  const speakLang = speakDir.lang ?? detectLang(line, userKey);
  const speakText =
    speakDir.directSay && speakDir.phrase ? speakDir.phrase : stripForSpeech(line);

  const audio = await synthesizeSpeech(speakText, {
    lang: speakLang,
    voice: speakDir.voice,
    forceVoice: speakDir.forceVoice,
  });
  if (!audio) {
    botWarn("voice", "No TTS audio — text reply only");
    const textChannel = await client.channels.fetch(session.textChannelId).catch(() => null);
    if (textChannel && textChannel.isSendable()) {
      await textChannel
        .send({
          content: `🎤 **${who}:** ${cleaned.slice(0, 400)}\n🐪 ${line.slice(0, 1500)}`,
          allowedMentions: { parse: [] },
        })
        .catch(() => undefined);
    }
    rememberThread(roomId, userId);
    return;
  }
  await playMp3(session, audio);
  rememberSpoken(session.guildId, speakText, userKey);
  rememberThread(roomId, userId);
}

function stripForSpeech(text: string): string {
  return cleanTextForTts(text);
}

async function playMp3(session: Session, mp3: Buffer): Promise<void> {
  const epoch = speakEpoch.get(session.guildId) ?? 0;
  session.speaking = true;
  const file = join(tmpdir(), `camel-tts-${Date.now()}.mp3`);
  try {
    await new Promise<void>((resolve, reject) => {
      const out = createWriteStream(file);
      Readable.from(mp3).pipe(out);
      out.on("finish", () => resolve());
      out.on("error", reject);
    });

    if ((speakEpoch.get(session.guildId) ?? 0) !== epoch) return;

    const resource = createAudioResource(file, { inputType: StreamType.Arbitrary });
    session.player.play(resource);

    await new Promise<void>((resolve, reject) => {
      const onIdle = () => {
        cleanup();
        resolve();
      };
      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };
      const cleanup = () => {
        session.player.off(AudioPlayerStatus.Idle, onIdle);
        session.player.off("error", onError);
      };
      if ((speakEpoch.get(session.guildId) ?? 0) !== epoch) {
        cleanup();
        resolve();
        return;
      }
      if (session.player.state.status === AudioPlayerStatus.Idle) {
        const t = setTimeout(() => {
          cleanup();
          resolve();
        }, 400);
        session.player.once(AudioPlayerStatus.Playing, () => {
          clearTimeout(t);
          session.player.once(AudioPlayerStatus.Idle, onIdle);
        });
        session.player.once("error", (err) => {
          clearTimeout(t);
          onError(err);
        });
        return;
      }
      session.player.once(AudioPlayerStatus.Idle, onIdle);
      session.player.once("error", onError);
    });

    if ((speakEpoch.get(session.guildId) ?? 0) === epoch) botOk("voice", "Spoke reply");
  } catch (err) {
    botFail("voice", `Play fail: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    session.speaking = false;
    try {
      unlinkSync(file);
    } catch {
      /* ignore */
    }
  }
}
