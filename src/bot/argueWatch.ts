import { generateRaw } from "./ai.js";
import { formatLog, recentLines } from "./chatLog.js";
import { clearChat } from "./chatModes.js";
import { isStaff, isTheKing } from "./permissions.js";
import { say } from "./outbox.js";
import type { IncomingChat } from "../types.js";

const HOSTILE =
  /\b(amk|aq|siktir|sg\b|gerizekal[ıi]|gerizekali|aptal|salak|mal\b|ezik|korkak|ibne|orospu|piç|pic\b|göt|gotune|shut up|stfu|idiot|stupid|trash|kapa[sş]? çene|sus lan|anani|ananı|bacini|fuck you|kys)\b/i;
const PLAYFUL =
  /\b(j\/k|jk\b|joke|şaka|saka|tak[ıi]l[ıi]yorum|kanka|abro|eğleniyoruz|eglence|lol\b|lmao|xdxd|😂|🤣)\b/i;
const CLEAR_CHANCE = 1 / 400;
const CLEAR_COOLDOWN_MS = 3 * 60 * 60_000;
const PAIR_TTL_MS = 4 * 60_000;

type Stage = "watch" | "flagged" | "warned" | "dropped";

type Pair = {
  aId: number;
  aName: string;
  bId: number;
  bName: string;
  aHits: number;
  bHits: number;
  lastAt: number;
  stage: Stage;
  judging: boolean;
  warnedAt: number;
  clearRolled: boolean;
};

const pairs = new Map<string, Pair>();
let lastClear = 0;

function keyOf(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function isHostile(text: string): boolean {
  return HOSTILE.test(text) && text.trim().length >= 3;
}

function mentionIds(text: string, names: Map<string, number>): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/@([a-zA-Z0-9_]+)/g)) {
    const id = names.get(m[1]!.toLowerCase());
    if (id) out.push(id);
  }
  return out;
}

function recentNames(broadcasterId: number): Map<string, number> {
  const map = new Map<string, number>();
  for (const line of recentLines(broadcasterId, 3 * 60_000)) {
    map.set(line.user.toLowerCase(), line.userId);
  }
  return map;
}

function lastOtherSpeaker(broadcasterId: number, selfId: number): { id: number; name: string } | null {
  const lines = recentLines(broadcasterId, 90_000).filter((l) => !l.bot && l.userId !== selfId);
  const last = lines[lines.length - 1];
  if (!last) return null;
  return { id: last.userId, name: last.user };
}

export async function notePossibleArgue(chat: IncomingChat): Promise<void> {
  if (!chat.content) return;
  if (isTheKing(chat.sender) || isStaff(chat.sender, chat.broadcaster)) return;
  const now = Date.now();
  prune(now);

  if (PLAYFUL.test(chat.content)) {
    dropIfInvolves(chat.sender.user_id);
    return;
  }
  if (!isHostile(chat.content)) return;

  const names = recentNames(chat.broadcaster.user_id);
  const mentioned = mentionIds(chat.content, names).filter((id) => id !== chat.sender.user_id);
  const target =
    mentioned[0] != null
      ? { id: mentioned[0], name: [...names.entries()].find((e) => e[1] === mentioned[0])?.[0] ?? "viewer" }
      : lastOtherSpeaker(chat.broadcaster.user_id, chat.sender.user_id);
  if (!target || target.id === chat.sender.user_id) return;

  const key = keyOf(chat.sender.user_id, target.id);
  const existing = pairs.get(key);
  const pair: Pair = existing ?? {
    aId: Math.min(chat.sender.user_id, target.id),
    aName: chat.sender.user_id < target.id ? chat.sender.username : target.name,
    bId: Math.max(chat.sender.user_id, target.id),
    bName: chat.sender.user_id < target.id ? target.name : chat.sender.username,
    aHits: 0,
    bHits: 0,
    lastAt: now,
    stage: "watch",
    judging: false,
    warnedAt: 0,
    clearRolled: false,
  };
  if (chat.sender.user_id === pair.aId) {
    pair.aHits += 1;
    pair.aName = chat.sender.username;
  } else {
    pair.bHits += 1;
    pair.bName = chat.sender.username;
  }
  pair.lastAt = now;
  pairs.set(key, pair);

  if (pair.stage === "dropped") return;
  if (pair.aHits < 2 || pair.bHits < 2) return;

  if (pair.stage === "watch") {
    pair.stage = "flagged";
    scheduleJudge(chat.broadcaster.user_id, key);
    return;
  }

  if (pair.stage === "warned" && now - pair.warnedAt > 25_000 && !pair.clearRolled) {
    pair.clearRolled = true;
    pairs.set(key, pair);
    await maybeClearAfterWarn(chat.broadcaster.user_id, pair);
  }
}

function dropIfInvolves(userId: number): void {
  for (const [key, pair] of pairs) {
    if (pair.aId === userId || pair.bId === userId) {
      pair.stage = "dropped";
      pairs.set(key, pair);
    }
  }
}

function scheduleJudge(broadcasterUserId: number, key: string): void {
  const pair = pairs.get(key);
  if (!pair || pair.judging) return;
  pair.judging = true;
  setTimeout(() => {
    void judge(broadcasterUserId, key);
  }, 8_000);
}

async function judge(broadcasterUserId: number, key: string): Promise<void> {
  const pair = pairs.get(key);
  if (!pair || pair.stage === "dropped") return;
  const lines = recentLines(broadcasterUserId, 2 * 60_000).filter(
    (l) => !l.bot && (l.userId === pair.aId || l.userId === pair.bId),
  );
  if (lines.some((l) => PLAYFUL.test(l.text))) {
    pair.stage = "dropped";
    pair.judging = false;
    pairs.set(key, pair);
    return;
  }
  const raw = await generateRaw(
    [
      `Two Kick chatters: @${pair.aName} and @${pair.bName}.`,
      `Their recent lines:\n${formatLog(lines, 16)}`,
      "Are they in a REAL hostile argument (insults, rage, personal attacks), or kidding / roasting for fun / not actually fighting?",
      "Reply with exactly one word: FIGHT or KIDDING or UNCLEAR.",
    ].join("\n"),
    "Classifier only. One word: FIGHT, KIDDING, or UNCLEAR. FIGHT only if it is a genuine hard argument, not banter.",
    { standalone: true },
  );
  pair.judging = false;
  const verdict = (raw ?? "UNCLEAR").toUpperCase();
  if (verdict.includes("KIDDING") || verdict.includes("UNCLEAR") || !verdict.includes("FIGHT")) {
    pair.stage = "dropped";
    pairs.set(key, pair);
    return;
  }
  pair.stage = "warned";
  pair.warnedAt = Date.now();
  pairs.set(key, pair);
  await say(
    `@${pair.aName} @${pair.bName} take it down. Argue off stream — this is a warning.`,
    undefined,
    broadcasterUserId,
  );
}

async function maybeClearAfterWarn(broadcasterUserId: number, pair: Pair): Promise<void> {
  if (Date.now() - lastClear < CLEAR_COOLDOWN_MS) return;
  if (Math.random() >= CLEAR_CHANCE) return;
  const lines = recentLines(broadcasterUserId, 40_000).filter(
    (l) => !l.bot && (l.userId === pair.aId || l.userId === pair.bId) && isHostile(l.text),
  );
  if (lines.length < 3) return;
  lastClear = Date.now();
  pair.stage = "dropped";
  await say(
    `@${pair.aName} @${pair.bName} still going. Chat is getting cleared.`,
    undefined,
    broadcasterUserId,
  );
  await clearChat();
}

function prune(now: number): void {
  for (const [key, pair] of pairs) {
    if (now - pair.lastAt > PAIR_TTL_MS) pairs.delete(key);
  }
}
