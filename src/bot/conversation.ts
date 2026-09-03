import { config } from "../config.js";
import { isOwnBotName } from "./bots.js";

/** Continue a bot conversation for 15s after the bot's last reply (not the user's message). */
const FOLLOW_MS = 15_000;
const MAX_THREADS = 80;

type Thread = { at: number };

const threads = new Map<string, Thread>();

function threadKey(roomId: string | number, userId: string | number): string {
  return `${roomId}:${userId}`;
}

function pruneThreads(now = Date.now()): void {
  for (const [key, row] of threads) {
    if (now - row.at > FOLLOW_MS) threads.delete(key);
  }
  if (threads.size <= MAX_THREADS) return;
  const oldest = [...threads.entries()].sort((a, b) => a[1].at - b[1].at);
  for (const [key] of oldest.slice(0, threads.size - MAX_THREADS)) threads.delete(key);
}

/**
 * Start/refresh the 15s untagged follow-up window.
 * Call ONLY after the bot has actually replied (chat text, voice, or silent order done) —
 * never when the user message arrives or while the bot is still thinking.
 */
export function rememberThread(roomId: string | number, userId: string | number): void {
  pruneThreads();
  threads.set(threadKey(roomId, userId), { at: Date.now() });
}

export function dropThread(roomId: string | number, userId: string | number): void {
  threads.delete(threadKey(roomId, userId));
}

export function inThread(roomId: string | number, userId: string | number): boolean {
  const row = threads.get(threadKey(roomId, userId));
  if (!row) return false;
  if (Date.now() - row.at > FOLLOW_MS) {
    threads.delete(threadKey(roomId, userId));
    return false;
  }
  return true;
}

export function talkingToSomeoneElse(content: string, replyToName?: string): boolean {
  if (replyToName && isOwnBotName(replyToName)) return false;
  if (replyToName && !isOwnBotName(replyToName)) return true;
  const me = config.bot.name.toLowerCase();
  const tags = content.match(/@([A-Za-z0-9_]+)/g) ?? [];
  return tags.some((tag) => {
    const name = tag.slice(1).toLowerCase();
    return name !== me && name !== "camel";
  });
}

export function looksLikeFollowUp(content: string, replyToName?: string): boolean {
  if (isOwnBotName(replyToName)) return true;
  if (talkingToSomeoneElse(content, replyToName)) return false;
  const t = content.replace(/\s+/g, " ").trim();
  if (t.length < 1) return false;
  if (/^(selam chat|sa chat|slm chat)\b/i.test(t)) return false;
  if (/^(gg|wp|nt|gl hf|glhf)\b/i.test(t)) return false;
  return true;
}

export function stillTalkingToUs(
  roomId: string | number,
  userId: string | number,
  content: string,
  replyToName?: string,
  replyToUs = false,
): boolean {
  if (replyToUs || isOwnBotName(replyToName)) return true;
  if (!inThread(roomId, userId)) return false;
  if (!looksLikeFollowUp(content, replyToName)) {
    dropThread(roomId, userId);
    return false;
  }
  return true;
}
