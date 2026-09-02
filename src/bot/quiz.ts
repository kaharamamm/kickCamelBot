import { generateRaw } from "./ai.js";
import { recentLines } from "./chatLog.js";
import { awardPoints } from "./points.js";
import { getSettings } from "./settings.js";
import { say } from "./outbox.js";
import type { IncomingChat } from "../types.js";

const QUIZ_EVERY_MS = 15 * 60_000;
const QUIZ_TTL_MS = 3 * 60_000;
const lastQuiz = new Map<number, number>();

type PendingQuiz = {
  userId: number;
  username: string;
  question: string;
  answers: string[];
  askedAt: number;
  attempts: number;
  home: boolean;
};

const pending = new Map<number, PendingQuiz>();

export function markQuizClock(broadcasterUserId: number): void {
  lastQuiz.set(broadcasterUserId, Date.now());
}

export function quizIsDue(broadcasterUserId: number): boolean {
  const now = Date.now();
  const current = pending.get(broadcasterUserId);
  if (current && now - current.askedAt > QUIZ_TTL_MS) pending.delete(broadcasterUserId);
  if (pending.has(broadcasterUserId)) return false;
  return now - (lastQuiz.get(broadcasterUserId) ?? 0) >= QUIZ_EVERY_MS;
}

export async function askQuiz(params: {
  slug: string;
  broadcasterUserId: number;
  title?: string;
  game?: string;
  home: boolean;
}): Promise<boolean> {
  const people = recentLines(params.broadcasterUserId, 12 * 60_000).filter(
    (l) =>
      !l.bot &&
      l.userId > 0 &&
      !["kickbot", "streamlabs", "streamelements", "nightbot"].includes(l.user.toLowerCase()),
  );
  if (people.length === 0) return false;
  const pick = people[Math.floor(Math.random() * people.length)];
  if (!pick) return false;

  const quiz = await buildQuiz(params.title, params.game, pick.user);
  if (!quiz) return false;

  pending.set(params.broadcasterUserId, {
    userId: pick.userId,
    username: pick.user,
    question: quiz.question,
    answers: quiz.answers,
    askedAt: Date.now(),
    attempts: 0,
    home: params.home,
  });
  lastQuiz.set(params.broadcasterUserId, Date.now());
  const prize = params.home ? ` First correct answer from you is ${getSettings().quizPoints} channel points.` : "";
  await say(`@${pick.user} ${quiz.question}${prize}`, undefined, params.broadcasterUserId);
  return true;
}

export async function tryAnswerQuiz(chat: IncomingChat): Promise<boolean> {
  const quiz = pending.get(chat.broadcaster.user_id);
  if (!quiz) return false;
  if (Date.now() - quiz.askedAt > QUIZ_TTL_MS) {
    pending.delete(chat.broadcaster.user_id);
    return false;
  }
  if (chat.sender.user_id !== quiz.userId) return false;
  if (chat.content.startsWith("!")) return false;

  if (isCorrect(chat.content, quiz.answers)) {
    pending.delete(chat.broadcaster.user_id);
    if (quiz.home) {
      const total = awardPoints(chat.sender.user_id, chat.sender.username, getSettings().quizPoints);
      await say(
        `@${chat.sender.username} that's it! +${getSettings().quizPoints} channel points (${total} total).`,
        chat.messageId,
        chat.broadcaster.user_id,
      );
    } else {
      await say(`@${chat.sender.username} that's it!`, chat.messageId, chat.broadcaster.user_id);
    }
    return true;
  }

  quiz.attempts += 1;
  if (quiz.attempts >= 2) {
    pending.delete(chat.broadcaster.user_id);
    await say(`@${chat.sender.username} not this time. Next quiz soon.`, chat.messageId, chat.broadcaster.user_id);
    return true;
  }
  await say(`@${chat.sender.username} close, try one more.`, chat.messageId, chat.broadcaster.user_id);
  return true;
}

async function buildQuiz(
  title: string | undefined,
  game: string | undefined,
  username: string,
): Promise<{ question: string; answers: string[] } | null> {
  const raw = await generateRaw(
    [
      `Stream title: ${title || "unknown"}`,
      `Game/category: ${game || "unknown"}`,
      `Ask @${username} one short trivia question about that game or stream title.`,
      `Return JSON only: {"question":"...","answers":["correct1","alias"]}`,
      "Question must be answerable from the given facts. Keep question under 140 characters. No markdown.",
    ].join("\n"),
    "You output JSON only.",
  );
  const parsed = parseQuiz(raw);
  if (parsed) return parsed;
  const fallbackAnswers = [game, title].filter((v): v is string => Boolean(v && v.trim()));
  if (!game && !title) return null;
  const topic = game || title || "this stream";
  return {
    question: `Quick one: what game/category is this stream on right now? (${topic} is the vibe)`,
    answers: fallbackAnswers,
  };
}

function parseQuiz(raw: string | null): { question: string; answers: string[] } | null {
  if (!raw) return null;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const json = JSON.parse(match[0]) as { question?: string; answers?: unknown };
    const question = String(json.question ?? "").replace(/\s+/g, " ").trim();
    const answers = Array.isArray(json.answers)
      ? json.answers.map((a) => String(a).trim()).filter(Boolean)
      : [];
    if (!question || answers.length === 0) return null;
    return { question, answers };
  } catch {
    return null;
  }
}

function isCorrect(content: string, answers: string[]): boolean {
  const got = normalize(content);
  if (!got) return false;
  return answers.some((answer) => {
    const want = normalize(answer);
    if (!want) return false;
    return got === want || got.includes(want) || want.includes(got);
  });
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/@\w+/g, " ")
    .replace(/[^a-z0-9ğüşöçıİ\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}
