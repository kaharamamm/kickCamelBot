import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { primaryCommand } from "./access.js";

const path = join(fileURLToPath(new URL(".", import.meta.url)), "../../data/commandTimers.json");

function readAll(): Record<string, number> {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, number>;
    const out: Record<string, number> = {};
    for (const [name, minutes] of Object.entries(parsed)) {
      if (Number.isFinite(minutes) && minutes >= 1) out[name] = Math.floor(minutes);
    }
    return out;
  } catch {
    return {};
  }
}

function writeAll(map: Record<string, number>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(map, null, 2));
}

export function getCommandTimer(name: string): number | null {
  const minutes = readAll()[primaryCommand(name)];
  return minutes && minutes >= 1 ? minutes : null;
}

export function setCommandTimer(name: string, minutes: number | null): void {
  const key = primaryCommand(name);
  const map = readAll();
  if (!minutes || minutes < 1) delete map[key];
  else map[key] = Math.min(180, Math.floor(minutes));
  writeAll(map);
}

export function listCommandTimers(): Array<{ name: string; minutes: number }> {
  return Object.entries(readAll()).map(([name, minutes]) => ({ name, minutes }));
}
