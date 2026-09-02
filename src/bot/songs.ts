export type SongRequest = {
  title: string;
  requester: string;
  requestedAt: number;
};

const queue: SongRequest[] = [];
const MAX_QUEUE = 30;

export function addSong(title: string, requester: string): { ok: true; position: number } | { ok: false; reason: string } {
  const clean = title.replace(/\s+/g, " ").trim();
  if (clean.length < 2) return { ok: false, reason: "Give me a song name. Example: !sr Never Gonna Give You Up" };
  if (queue.length >= MAX_QUEUE) return { ok: false, reason: "Song queue is full (30). Try again after a few plays." };
  if (queue.some((s) => s.title.toLowerCase() === clean.toLowerCase())) {
    return { ok: false, reason: "That song is already in the queue." };
  }
  queue.push({ title: clean, requester, requestedAt: Date.now() });
  return { ok: true, position: queue.length };
}

export function nowPlaying(): SongRequest | undefined {
  return queue[0];
}

export function skipSong(): SongRequest | undefined {
  return queue.shift();
}

export function formatQueue(limit = 5): string {
  if (queue.length === 0) return "Queue is empty. Request one with !sr <song>";
  const lines = queue.slice(0, limit).map((song, i) => `${i + 1}. ${song.title} (${song.requester})`);
  const extra = queue.length > limit ? ` +${queue.length - limit} more` : "";
  return `${lines.join(" | ")}${extra}`;
}

export function queueLength(): number {
  return queue.length;
}
