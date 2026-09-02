import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const path = join(fileURLToPath(new URL(".", import.meta.url)), "../../data/modlog.json");
const MAX = 200;

export type ModActionType = "delete" | "timeout" | "ban" | "warn";

export type ModLogEntry = {
  id: string;
  at: number;
  action: ModActionType;
  username: string;
  userId: number;
  reason: string;
  detail?: string;
  message?: string;
};

function readAll(): ModLogEntry[] {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { entries?: ModLogEntry[] };
    return Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch {
    return [];
  }
}

function writeAll(entries: ModLogEntry[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ entries: entries.slice(0, MAX) }, null, 2));
}

export function logMod(entry: Omit<ModLogEntry, "id" | "at"> & { at?: number }): ModLogEntry {
  const row: ModLogEntry = {
    id: randomUUID().slice(0, 8),
    at: entry.at ?? Date.now(),
    action: entry.action,
    username: entry.username,
    userId: entry.userId,
    reason: entry.reason.slice(0, 240),
    detail: entry.detail?.slice(0, 240),
    message: entry.message?.replace(/\s+/g, " ").trim().slice(0, 280),
  };
  writeAll([row, ...readAll()].slice(0, MAX));
  return row;
}

export function removeModLog(id: string): boolean {
  const all = readAll();
  const next = all.filter((row) => row.id !== id);
  if (next.length === all.length) return false;
  writeAll(next);
  return true;
}

export function listModLog(limit = 80): ModLogEntry[] {
  return readAll().slice(0, limit);
}
