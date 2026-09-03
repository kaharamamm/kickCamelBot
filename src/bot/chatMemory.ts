import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const path = join(fileURLToPath(new URL(".", import.meta.url)), "../../data/chatMemory.json");
export const CHAT_WINDOW = 10;
const SUMMARY_CHARS = 280;

type RoomMemory = {
  summary: string;
  lastAt: number;
  lastSummaryAt: number;
};

const rooms = new Map<number, RoomMemory>();
const pending = new Map<number, number>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();
let loaded = false;
let writing = false;

function hydrate(): void {
  if (loaded) return;
  loaded = true;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, RoomMemory>;
    for (const [id, row] of Object.entries(parsed)) {
      const n = Number(id);
      if (n && row?.summary) {
        rooms.set(n, {
          summary: row.summary.replace(/\s+/g, " ").trim().slice(0, SUMMARY_CHARS),
          lastAt: row.lastAt ?? 0,
          lastSummaryAt: row.lastSummaryAt ?? 0,
        });
      }
    }
  } catch {
    // first run
  }
}

function persist(): void {
  if (writing) return;
  writing = true;
  setTimeout(() => {
    writing = false;
    hydrate();
    const out: Record<string, RoomMemory> = {};
    for (const [id, row] of rooms.entries()) {
      if (!row.summary) continue;
      out[String(id)] = row;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(out));
  }, 1200);
}

/** Call from rememberLine. After 10 new chat lines, refresh the room summary. */
export function noteRoomLine(broadcasterId: number): void {
  if (!broadcasterId) return;
  hydrate();
  const n = (pending.get(broadcasterId) ?? 0) + 1;
  pending.set(broadcasterId, n);
  const row = rooms.get(broadcasterId);
  if (row) row.lastAt = Date.now();
  if (n < CHAT_WINDOW) return;
  scheduleSummary(broadcasterId);
}

export function chatSummary(broadcasterId: number): string {
  if (!broadcasterId) return "";
  hydrate();
  return rooms.get(broadcasterId)?.summary ?? "";
}

export function listChatSummaries(): Array<{
  channelId: number;
  summary: string;
  lastAt: number;
  lastSummaryAt: number;
}> {
  hydrate();
  return [...rooms.entries()]
    .map(([channelId, row]) => ({
      channelId,
      summary: row.summary,
      lastAt: row.lastAt,
      lastSummaryAt: row.lastSummaryAt,
    }))
    .sort((a, b) => (a.channelId === 549839 ? -1 : b.channelId === 549839 ? 1 : b.lastAt - a.lastAt));
}

function scheduleSummary(broadcasterId: number): void {
  const prev = timers.get(broadcasterId);
  if (prev) clearTimeout(prev);
  timers.set(
    broadcasterId,
    setTimeout(() => {
      timers.delete(broadcasterId);
      void summarizeRoom(broadcasterId);
    }, 2500),
  );
}

async function summarizeRoom(broadcasterId: number): Promise<void> {
  hydrate();
  if ((pending.get(broadcasterId) ?? 0) < CHAT_WINDOW) return;

  const existing = rooms.get(broadcasterId);
  const wait = existing ? 20_000 - (Date.now() - existing.lastSummaryAt) : 0;
  if (wait > 0) {
    const prev = timers.get(broadcasterId);
    if (prev) clearTimeout(prev);
    timers.set(
      broadcasterId,
      setTimeout(() => {
        timers.delete(broadcasterId);
        void summarizeRoom(broadcasterId);
      }, wait),
    );
    return;
  }

  pending.set(broadcasterId, 0);
  const { formatLastChat, lastChatLines } = await import("./chatLog.js");
  const lines = lastChatLines(broadcasterId, CHAT_WINDOW);
  const nonBot = lines.filter((l) => !l.bot);
  if (nonBot.length < 3) return;

  const window = formatLastChat(broadcasterId, CHAT_WINDOW);
  if (!window) return;

  const prev = existing?.summary ?? "";
  const { generateRaw } = await import("./ai.js");
  const raw = await generateRaw(
    [
      prev ? `Previous room summary (older context, compress if stale): ${prev}` : "No previous room summary.",
      `Last ${CHAT_WINDOW} chat lines (oldest→newest):\n${window}`,
      "Write one compact English operator note (max 240 characters) of what THIS chat is talking about.",
      "Keep the current topic, running jokes, arguments, and any pending streamer/bot business (title, game, raid, clip).",
      "Drop topics that disappeared from the last 10 unless they still explain a live reference.",
      "Do not invent facts. Nickname-only, never real/legal names. Plain text. No username prefix.",
    ].join("\n"),
    "You write private English room-memory notes for a Kick chat bot. One or two sentences. Topic only.",
    { standalone: true, timeoutMs: 90_000, tokens: 180, temperature: 0.2 },
  );
  const cleaned = (raw || "").replace(/\s+/g, " ").trim().slice(0, SUMMARY_CHARS);
  if (!cleaned) return;
  rooms.set(broadcasterId, {
    summary: cleaned,
    lastAt: Date.now(),
    lastSummaryAt: Date.now(),
  });
  persist();
}
