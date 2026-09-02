import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const path = join(fileURLToPath(new URL(".", import.meta.url)), "../../data/timed.json");

export type TimedCommand = {
  id: string;
  text: string;
  minutes: number;
  enabled: boolean;
};

function readAll(): TimedCommand[] {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { timed?: TimedCommand[] };
    if (!Array.isArray(parsed.timed)) return [];
    return parsed.timed.filter((row) => row?.id && row?.text && row.minutes >= 1);
  } catch {
    return [];
  }
}

function writeAll(timed: TimedCommand[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ timed }, null, 2));
}

export function listTimedCommands(): TimedCommand[] {
  return readAll();
}

export function addTimedCommand(text: string, minutes: number): TimedCommand {
  const clean = text.replace(/\s+/g, " ").trim();
  const mins = Math.min(180, Math.max(1, Math.floor(minutes)));
  if (!clean) throw new Error("Timed message is empty");
  if (clean.length > 400) throw new Error("Timed message is too long (max 400)");
  const created: TimedCommand = { id: randomUUID().slice(0, 8), text: clean, minutes: mins, enabled: true };
  writeAll([...readAll(), created]);
  return created;
}

export function removeTimedCommand(id: string): void {
  writeAll(readAll().filter((row) => row.id !== id));
}

export function updateTimedMinutes(id: string, minutes: number | null): void {
  writeAll(
    readAll().map((row) => {
      if (row.id !== id) return row;
      if (!minutes) return { ...row, enabled: false };
      return { ...row, minutes, enabled: true };
    }),
  );
}
