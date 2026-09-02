import { say } from "./outbox.js";
import { clipChat } from "../kick/api.js";

export type Poll = {
  broadcasterUserId: number;
  question: string;
  options: string[];
  votes: Map<number, number>;
  endsAt: number;
  closer?: ReturnType<typeof setTimeout>;
};

const active = new Map<number, Poll>();

export function parsePollArgs(args: string): { question: string; options: string[] } {
  const text = args.replace(/\s+/g, " ").trim();
  if (!text) return { question: "Will he win the game?", options: ["yes", "no"] };
  const pipe = text.split(/\s*\|\s*/).map((s) => s.trim()).filter(Boolean);
  if (pipe.length >= 3) return { question: clipQ(pipe[0]!), options: pipe.slice(1, 7).map(clipOpt) };
  const slash = text.split(/\s+\/\s+/).map((s) => s.trim()).filter(Boolean);
  if (slash.length >= 3) return { question: clipQ(slash[0]!), options: slash.slice(1, 7).map(clipOpt) };
  return { question: clipQ(text), options: ["yes", "no"] };
}

export function currentPoll(broadcasterUserId: number): Poll | undefined {
  return active.get(broadcasterUserId);
}

export async function startPoll(params: {
  broadcasterUserId: number;
  question: string;
  options: string[];
  minutes?: number;
}): Promise<string> {
  const existing = active.get(params.broadcasterUserId);
  if (existing) return "A poll is already running. !pollend to close it.";
  const options = params.options.map(clipOpt).filter(Boolean).slice(0, 6);
  if (options.length < 2) return "Need at least two options.";
  const mins = Math.min(15, Math.max(1, params.minutes ?? 2));
  const poll: Poll = {
    broadcasterUserId: params.broadcasterUserId,
    question: clipQ(params.question),
    options,
    votes: new Map(),
    endsAt: Date.now() + mins * 60_000,
  };
  poll.closer = setTimeout(() => {
    void closePoll(params.broadcasterUserId, true);
  }, mins * 60_000);
  active.set(params.broadcasterUserId, poll);
  const opts = options.map((o, i) => `${i + 1}) ${o}`).join(" · ");
  return clipChat(`POLL: ${poll.question} ${opts} — vote with !vote 1 or type the option. Closes in ${mins}m.`);
}

export function castVote(broadcasterUserId: number, userId: number, raw: string): string | null {
  const poll = active.get(broadcasterUserId);
  if (!poll) return null;
  const idx = matchOption(poll.options, raw);
  if (idx < 0) return null;
  poll.votes.set(userId, idx);
  return `Vote locked: ${poll.options[idx]}`;
}

export async function closePoll(broadcasterUserId: number, announce: boolean): Promise<string> {
  const poll = active.get(broadcasterUserId);
  if (!poll) return "No poll is running.";
  if (poll.closer) clearTimeout(poll.closer);
  active.delete(broadcasterUserId);
  const line = formatResults(poll);
  if (announce) await say(line, undefined, broadcasterUserId);
  return line;
}

export function tryBareVote(broadcasterUserId: number, userId: number, content: string): boolean {
  const poll = active.get(broadcasterUserId);
  if (!poll) return false;
  const text = content.trim();
  if (!text || text.length > 24) return false;
  return matchOption(poll.options, text) >= 0 && Boolean(castVote(broadcasterUserId, userId, text));
}

function matchOption(options: string[], raw: string): number {
  const got = norm(raw.replace(/^!vote\s+/i, ""));
  if (!got) return -1;
  const asNum = Number(got);
  if (Number.isInteger(asNum) && asNum >= 1 && asNum <= options.length) return asNum - 1;
  const aliases: Record<string, string[]> = {
    yes: ["yes", "y", "evet", "e", "win", "kazanir", "kazanır"],
    no: ["no", "n", "hayir", "hayır", "h", "lose", "kaybeder"],
  };
  for (let i = 0; i < options.length; i++) {
    const opt = options[i]!;
    const key = norm(opt);
    if (got === key || key.startsWith(got) || got.startsWith(key)) return i;
    const extra = aliases[key];
    if (extra?.includes(got)) return i;
  }
  return -1;
}

function formatResults(poll: Poll): string {
  const counts = poll.options.map(() => 0);
  for (const idx of poll.votes.values()) {
    if (counts[idx] !== undefined) counts[idx] += 1;
  }
  const total = counts.reduce((a, b) => a + b, 0);
  const parts = poll.options.map((opt, i) => {
    const n = counts[i] ?? 0;
    const pct = total ? Math.round((n / total) * 100) : 0;
    return `${opt} ${n} (${pct}%)`;
  });
  let winner = "It's a tie.";
  if (total > 0) {
    const best = Math.max(...counts);
    const winners = poll.options.filter((_, i) => counts[i] === best);
    winner = winners.length === 1 ? `${winners[0]} wins!` : `Tie: ${winners.join(" & ")}`;
  }
  return clipChat(`Poll closed: ${poll.question} ${parts.join(" · ")} — ${winner} (${total} vote${total === 1 ? "" : "s"})`);
}

function clipQ(value: string): string {
  const t = value.replace(/\s+/g, " ").trim().replace(/\?*$/, "?");
  return t.slice(0, 140);
}

function clipOpt(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 32);
}

function norm(value: string): string {
  return value.toLocaleLowerCase("tr-TR").replace(/[^\p{L}\p{N}]+/gu, "").trim();
}
