import { generateLine } from "./ai.js";
import { detectEmoteSpam, formatLog, lastFiveFromThisBot, lastNonBotActivity, recentLines } from "./chatLog.js";
import { langInstruction, type ChatLang } from "./lang.js";
import { channelLiveStatus } from "./liveState.js";
import { say } from "./outbox.js";
import { askQuiz, markQuizClock, quizIsDue } from "./quiz.js";
import { yenimahalleWeather } from "./weather.js";
import { getMyChannelCached } from "../kick/api.js";
import { formatStreamContext, lookupPublicChannel } from "../kick/publicChannel.js";
import { personNote, noteExchange } from "./memory.js";
import { maybeRandomEmoteMode } from "./emoteMode.js";
import { noteStreamContext } from "./recap.js";
import { config } from "../config.js";

const TICK_MS = 30_000;
const JOIN_EVERY_MS = 3 * 60_000;
const IDLE_MIN_MS = 5 * 60_000;
const IDLE_MAX_MS = 10 * 60_000;
const EMOTE_COOLDOWN_MS = 45_000;
const QUESTION_COOLDOWN_MS = 20_000;

type RoomRef = {
  slug: string;
  broadcasterUserId: number;
};

const lastEmote = new Map<number, number>();
const lastQuestion = new Map<number, number>();
const lastJoin = new Map<number, number>();
const lastIdle = new Map<number, number>();
const idleWait = new Map<number, number>();
const lastPosted = new Map<number, number>();
let rooms: RoomRef[] = [];
let tickTimer: ReturnType<typeof setInterval> | undefined;
const startedAt = { t: 0 };

function rollIdleWait(): number {
  return IDLE_MIN_MS + Math.floor(Math.random() * (IDLE_MAX_MS - IDLE_MIN_MS + 1));
}

export function startEngagement(next: RoomRef[]): void {
  stopEngagement();
  rooms = next;
  startedAt.t = Date.now();
  for (const room of rooms) {
    lastJoin.set(room.broadcasterUserId, Date.now());
    lastIdle.set(room.broadcasterUserId, Date.now());
    idleWait.set(room.broadcasterUserId, rollIdleWait());
    markQuizClock(room.broadcasterUserId);
  }
  tickTimer = setInterval(() => {
    for (const room of rooms) void tick(room);
  }, TICK_MS);
  console.log(`[engage] watching ${rooms.map((r) => r.slug).join(", ")} (join 3m / idle 5-10m / quiz 15m)`);
}

export function stopEngagement(): void {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = undefined;
  rooms = [];
}

export function noteBotSpoke(broadcasterUserId: number): void {
  const now = Date.now();
  lastPosted.set(broadcasterUserId, now);
  lastJoin.set(broadcasterUserId, now);
}

export async function maybeJoinEmoteSpam(broadcasterUserId: number): Promise<boolean> {
  const token = detectEmoteSpam(broadcasterUserId);
  if (!token) return false;
  const last = lastEmote.get(broadcasterUserId) ?? 0;
  if (Date.now() - last < EMOTE_COOLDOWN_MS) return false;
  lastEmote.set(broadcasterUserId, Date.now());
  lastPosted.set(broadcasterUserId, Date.now());
  const repeat = Math.min(6, 3 + Math.floor(Math.random() * 4));
  await say(Array(repeat).fill(token).join(" "), undefined, broadcasterUserId);
  return true;
}

export async function maybeAnswerQuestion(params: {
  broadcasterUserId: number;
  slug: string;
  username: string;
  userId?: number;
  content: string;
  lang?: ChatLang;
  respectful?: boolean;
}): Promise<boolean> {
  const last = lastQuestion.get(params.broadcasterUserId) ?? 0;
  if (Date.now() - last < QUESTION_COOLDOWN_MS) return false;
  lastQuestion.set(params.broadcasterUserId, Date.now());
  const ctx = await streamContext(params.slug, params.broadcasterUserId);
  const weather = await yenimahalleWeather();
  const memory = params.userId ? personNote(params.userId) : "";
  const line = await generateLine(
    [
      ctx,
      `Weather: ${weather}`,
      `Recent chat:\n${formatLog(recentLines(params.broadcasterUserId, 3 * 60_000), 8)}`,
      `${params.username} asked: ${params.content}`,
      memory ? `What you remember about ${params.username}: ${memory}` : "",
      params.lang ? langInstruction(params.lang) : "",
      params.respectful
        ? "Verified streamer's first message. No sarcasm. Be respectful."
        : "",
      `Answer @${params.username} briefly in chat. Stay on the stream topic when it fits. If they asked weather, use Yenimahalle/Ankara and you may roast Ankara weather.`,
      "Do not invent Dota 2 / match / rank / KDA numbers.",
      "Do not mention mcvckaharamamm unless they asked about him.",
    ]
      .filter(Boolean)
      .join("\n"),
  );
  if (!line) return false;
  lastPosted.set(params.broadcasterUserId, Date.now());
  if (params.userId) noteExchange(params.userId, params.username, params.content, line);
  await say(line, undefined, params.broadcasterUserId);
  return true;
}

async function tick(room: RoomRef): Promise<void> {
  const now = Date.now();
  if (now - startedAt.t < 20_000) return;
  const status = await channelLiveStatus(room.slug, room.broadcasterUserId);
  if (status.isHome) noteStreamContext(status.game, status.startedAt, status.live);
  if (!status.chatterOk) return;
  if (status.isHome && status.live) void maybeRandomEmoteMode(room.broadcasterUserId);

  if (quizIsDue(room.broadcasterUserId) && now - (lastPosted.get(room.broadcasterUserId) ?? 0) >= 40_000) {
    const asked = await askQuiz({
      slug: room.slug,
      broadcasterUserId: room.broadcasterUserId,
      title: status.title,
      game: status.game,
      home: status.isHome,
    });
    if (asked) {
      lastPosted.set(room.broadcasterUserId, Date.now());
      return;
    }
  }

  const recent = recentLines(room.broadcasterUserId, JOIN_EVERY_MS).filter((l) => !l.bot);
  const people = new Set(recent.map((l) => l.userId)).size;
  const talking = recent.length >= 3 && people >= 2;
  const lastHuman = lastNonBotActivity(room.broadcasterUserId);
  const posted = lastPosted.get(room.broadcasterUserId) ?? 0;
  const wait = idleWait.get(room.broadcasterUserId) ?? rollIdleWait();
  if (!idleWait.has(room.broadcasterUserId)) idleWait.set(room.broadcasterUserId, wait);

  if (talking && now - (lastJoin.get(room.broadcasterUserId) ?? 0) >= JOIN_EVERY_MS && now - posted >= 50_000) {
    const joined = await joinIfTalking(room, recent);
    if (joined) lastJoin.set(room.broadcasterUserId, now);
    return;
  }

  if (lastFiveFromThisBot(room.broadcasterUserId)) return;

  const quietLongEnough = lastHuman === 0 ? now - startedAt.t >= wait : now - lastHuman >= wait;
  if (
    !talking &&
    quietLongEnough &&
    now - (lastIdle.get(room.broadcasterUserId) ?? 0) >= wait &&
    now - posted >= 40_000
  ) {
    const postedIdle = await idlePrompt(room);
    if (postedIdle) {
      lastIdle.set(room.broadcasterUserId, now);
      idleWait.set(room.broadcasterUserId, rollIdleWait());
    }
  }
}

async function joinIfTalking(room: RoomRef, lines: ReturnType<typeof recentLines>): Promise<boolean> {
  const ctx = await streamContext(room.slug, room.broadcasterUserId);
  const line = await generateLine(
    [
      ctx,
      "Chat has been talking. Jump in like a regular, one short line. Do not greet the whole room. React to what they actually said. Stay on that topic. Do not mention Dota, heroes, MMR, or hair unless they did. No hashtags.",
      formatLog(lines, 8),
    ].join("\n\n"),
  );
  if (!line) return false;
  lastPosted.set(room.broadcasterUserId, Date.now());
  await say(line, undefined, room.broadcasterUserId);
  return true;
}

async function idlePrompt(room: RoomRef): Promise<boolean> {
  const ctx = await streamContext(room.slug, room.broadcasterUserId);
  const line = await generateLine(
    [
      ctx,
      "Chat has been quiet. Drop one short comment or a fun question about the current game or stream title. Do not say chat is quiet. Do not introduce yourself. Do not mention mcvckaharamamm.",
    ].join("\n"),
  );
  if (!line) return false;
  lastPosted.set(room.broadcasterUserId, Date.now());
  await say(line, undefined, room.broadcasterUserId);
  return true;
}

async function streamContext(slug: string, broadcasterUserId: number): Promise<string> {
  try {
    const mine = await getMyChannelCached();
    if (mine.broadcaster_user_id === broadcasterUserId) {
      return formatStreamContext({
        slug: mine.slug,
        title: mine.stream_title,
        game: mine.category?.name,
        live: mine.stream?.is_live,
      });
    }
  } catch {
    // extra channel
  }
  try {
    const pub = await lookupPublicChannel(slug);
    return formatStreamContext(pub);
  } catch {
    return `Channel: ${slug}. You are ${config.bot.name} in this Kick chat.`;
  }
}
