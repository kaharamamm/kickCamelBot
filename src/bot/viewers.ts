import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ankaraDay } from "./clock.js";

const path = join(fileURLToPath(new URL(".", import.meta.url)), "../../data/viewers.json");

type Viewer = {
  username: string;
  firstSeen: number;
  lastDay: string;
  strikes: number;
  lastStrikeAt: number;
  spamHits: number;
  lastSpamAt: number;
  verifiedGreeted?: boolean;
};

function readAll(): Record<string, Viewer> {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, Viewer>;
  } catch {
    return {};
  }
}

function writeAll(map: Record<string, Viewer>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(map, null, 2));
}

function row(userId: number, username: string): Viewer {
  const all = readAll();
  const existing = all[String(userId)];
  if (existing) {
    existing.username = username;
    return existing;
  }
  return {
    username,
    firstSeen: Date.now(),
    lastDay: "",
    strikes: 0,
    lastStrikeAt: 0,
    spamHits: 0,
    lastSpamAt: 0,
    verifiedGreeted: false,
  };
}

function save(userId: number, viewer: Viewer): void {
  const all = readAll();
  all[String(userId)] = viewer;
  writeAll(all);
}

export function markChat(userId: number, username: string): { brandNew: boolean; firstToday: boolean } {
  const viewer = row(userId, username);
  const day = ankaraDay();
  const brandNew = !viewer.lastDay;
  const firstToday = viewer.lastDay !== day;
  viewer.lastDay = day;
  save(userId, viewer);
  return { brandNew, firstToday };
}

export function bumpStrike(userId: number, username: string): number {
  const viewer = row(userId, username);
  if (Date.now() - viewer.lastStrikeAt > 24 * 60 * 60_000) viewer.strikes = 0;
  viewer.strikes += 1;
  viewer.lastStrikeAt = Date.now();
  save(userId, viewer);
  return viewer.strikes;
}

export function takeVerifiedFirst(userId: number, username: string): boolean {
  const viewer = row(userId, username);
  if (viewer.verifiedGreeted) return false;
  viewer.verifiedGreeted = true;
  save(userId, viewer);
  return true;
}

export function bumpSpam(userId: number, username: string): number {
  const viewer = row(userId, username);
  if (Date.now() - viewer.lastSpamAt > 10 * 60_000) viewer.spamHits = 0;
  viewer.spamHits += 1;
  viewer.lastSpamAt = Date.now();
  save(userId, viewer);
  return viewer.spamHits;
}
