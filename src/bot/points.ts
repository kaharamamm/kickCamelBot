import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const path = join(fileURLToPath(new URL(".", import.meta.url)), "../../data/points.json");

type Row = { username: string; points: number };
type Store = { users: Record<string, Row> };

function readStore(): Store {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Store;
    if (parsed?.users && typeof parsed.users === "object") return parsed;
  } catch {
    // first run
  }
  return { users: {} };
}

function writeStore(store: Store): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(store, null, 2));
}

export function getPoints(userId: number): number {
  return readStore().users[String(userId)]?.points ?? 0;
}

export function awardPoints(userId: number, username: string, amount: number): number {
  const store = readStore();
  const key = String(userId);
  const current = store.users[key]?.points ?? 0;
  const next = current + amount;
  store.users[key] = { username, points: next };
  writeStore(store);
  return next;
}
