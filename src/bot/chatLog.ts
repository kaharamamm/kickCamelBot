export type LogLine = {
  at: number;
  user: string;
  userId: number;
  text: string;
  raw: string;
  /** True only for CamelBot's own posted lines. */
  bot?: boolean;
};

const logs = new Map<number, LogLine[]>();
const MAX = 48;
const TTL_MS = 8 * 60_000;

export function rememberLine(broadcasterId: number, line: LogLine): void {
  const list = logs.get(broadcasterId) ?? [];
  list.push({
    ...line,
    text: line.text.slice(0, 180),
    raw: line.raw.slice(0, 220),
  });
  const since = Date.now() - TTL_MS;
  let drop = 0;
  while (drop < list.length && list[drop]!.at < since) drop += 1;
  if (drop) list.splice(0, drop);
  if (list.length > MAX) list.splice(0, list.length - MAX);
  logs.set(broadcasterId, list);
}

export function recentLines(broadcasterId: number, ms: number): LogLine[] {
  const since = Date.now() - ms;
  return (logs.get(broadcasterId) ?? []).filter((l) => l.at >= since);
}

export function formatLog(lines: LogLine[], limit = 12): string {
  return lines
    .slice(-limit)
    .map((l) => `${l.user}: ${l.text}`)
    .join("\n");
}

/** Tiny room snapshot for AI context. Not a full log. */
export function roomSnapshot(broadcasterId: number, skipUserId?: number, limit = 5): string {
  const lines = (logs.get(broadcasterId) ?? [])
    .filter((l) => !skipUserId || l.userId !== skipUserId)
    .slice(-limit);
  if (lines.length === 0) return "";
  return lines.map((l) => `${l.user}: ${l.text.slice(0, 72)}`).join(" · ");
}

export function lastActivity(broadcasterId: number): number {
  const list = logs.get(broadcasterId) ?? [];
  return list[list.length - 1]?.at ?? 0;
}

export function lastNonBotActivity(broadcasterId: number): number {
  const list = logs.get(broadcasterId) ?? [];
  for (let i = list.length - 1; i >= 0; i--) {
    if (!list[i]?.bot) return list[i]!.at;
  }
  return 0;
}

export function lastFiveFromThisBot(broadcasterId: number): boolean {
  const list = logs.get(broadcasterId) ?? [];
  if (list.length < 5) return false;
  return list.slice(-5).every((l) => l.bot === true);
}

const LAUGH =
  /(?:\b(?:l+o+l+|lmao+|lmfao|rofl|kekw+|h+a+h+a+|a+h+a+|jsjs+|jajaja+|wkwk+|xd+|asf+|sksk+|ağlad[ıi]m|sictim|sıçt[ıi]m|öldüm|gülüyorum|guldum)\b|[😂🤣😭💀])/i;

export function detectLaughBurst(broadcasterId: number): { users: number; emotes: number } | null {
  const lines = recentLines(broadcasterId, 25_000).filter((l) => !l.bot);
  let emotes = 0;
  const users = new Set<number>();
  for (const line of lines) {
    const n = countEmotes(line.raw, line.text);
    if (n <= 0) continue;
    emotes += n;
    users.add(line.userId);
  }
  if (emotes < 20 || users.size < 5) return null;
  return { users: users.size, emotes };
}

function countEmotes(raw: string, text: string): number {
  const kick = raw.match(/\[emote:\d+:[^\]]+\]/g)?.length ?? 0;
  const emoji = `${raw} ${text}`.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}😂🤣😭💀]/gu)?.length ?? 0;
  return kick + emoji;
}

export function detectEmoteSpam(broadcasterId: number): string | null {
  const lines = recentLines(broadcasterId, 25_000).filter((l) => !l.bot).slice(-10);
  if (lines.length < 4) return null;
  const tokens = lines.map(dominantToken).filter(Boolean) as string[];
  if (tokens.length < 4) return null;
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  let best = "";
  let n = 0;
  for (const [token, count] of counts) {
    if (count > n) {
      best = token;
      n = count;
    }
  }
  if (n < 4) return null;
  return best;
}

function dominantToken(line: LogLine): string | null {
  const emote = line.raw.match(/\[emote:\d+:[^\]]+\]/)?.[0];
  if (emote) return emote;
  const compact = line.text.replace(/\s+/g, " ").trim();
  if (compact.length === 0 || compact.length > 24) return null;
  if (compact.startsWith("!")) return null;
  return compact;
}
