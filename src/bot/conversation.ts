import { config } from "../config.js";
import { isOwnBotName } from "./bots.js";

const FOLLOW_MS = 3 * 60_000;
const MAX_THREADS = 60;

type Thread = { at: number };

const threads = new Map<string, Thread>();

function threadKey(broadcasterUserId: number, userId: number): string {
  return `${broadcasterUserId}:${userId}`;
}

function pruneThreads(now = Date.now()): void {
  for (const [key, row] of threads) {
    if (now - row.at > FOLLOW_MS) threads.delete(key);
  }
  if (threads.size <= MAX_THREADS) return;
  const oldest = [...threads.entries()].sort((a, b) => a[1].at - b[1].at);
  for (const [key] of oldest.slice(0, threads.size - MAX_THREADS)) threads.delete(key);
}

export function rememberThread(broadcasterUserId: number, userId: number): void {
  pruneThreads();
  threads.set(threadKey(broadcasterUserId, userId), { at: Date.now() });
}

export function dropThread(broadcasterUserId: number, userId: number): void {
  threads.delete(threadKey(broadcasterUserId, userId));
}

export function inThread(broadcasterUserId: number, userId: number): boolean {
  const row = threads.get(threadKey(broadcasterUserId, userId));
  if (!row) return false;
  if (Date.now() - row.at > FOLLOW_MS) {
    threads.delete(threadKey(broadcasterUserId, userId));
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
  broadcasterUserId: number,
  userId: number,
  content: string,
  replyToName?: string,
  replyToUs = false,
): boolean {
  if (replyToUs || isOwnBotName(replyToName)) return true;
  if (!inThread(broadcasterUserId, userId)) return false;
  if (!looksLikeFollowUp(content, replyToName)) {
    dropThread(broadcasterUserId, userId);
    return false;
  }
  return true;
}
