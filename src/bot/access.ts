import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isStaff } from "./permissions.js";
import type { KickActor } from "../types.js";

export type AccessLevel = "everyone" | "mods" | "broadcaster";

export const ACCESS_LEVELS: AccessLevel[] = ["everyone", "mods", "broadcaster"];

const path = join(fileURLToPath(new URL(".", import.meta.url)), "../../data/access.json");

export const COMMAND_PRIMARY: Record<string, string> = {
  help: "commands",
  cmd: "commands",
  cb: "commands",
  random: "roll",
  zar: "roll",
  coin: "coinflip",
  yazitura: "coinflip",
  "8": "8ball",
  songrequest: "sr",
  istek: "sr",
  np: "song",
  playing: "song",
  q: "queue",
  baslik: "title",
  game: "category",
  cat: "category",
  kategori: "category",
  emotes: "emoteonly",
  emote: "emoteonly",
  slowmode: "slow",
  followers: "followonly",
  subscribers: "subonly",
  klip: "clip",
  kicks: "top",
  leaderboard: "top",
  lb: "top",
  loyalty: "rewards",
  oduller: "rewards",
  image: "draw",
  drawimage: "draw",
  addreward: "rewardadd",
  gamble: "poll",
  pollend: "poll",
  saat: "time",
  hava: "weather",
  rank: "mmr",
  score: "wl",
  record: "wl",
  lg: "lastgame",
  lgs: "lastgame",
};

export const DEFAULT_ACCESS: Record<string, AccessLevel> = {
  ping: "everyone",
  commands: "everyone",
  roll: "everyone",
  coinflip: "everyone",
  "8ball": "everyone",
  sr: "everyone",
  song: "everyone",
  queue: "everyone",
  skip: "mods",
  title: "mods",
  category: "mods",
  emoteonly: "mods",
  slow: "mods",
  followonly: "mods",
  subonly: "mods",
  clear: "mods",
  clip: "mods",
  top: "everyone",
  rewards: "everyone",
  points: "everyone",
  rewardadd: "mods",
  draw: "everyone",
  poll: "mods",
  vote: "everyone",
  time: "everyone",
  weather: "everyone",
  dota: "everyone",
  mmr: "everyone",
  wl: "everyone",
  lastgame: "everyone",
  medal: "everyone",
};

function readAccess(): Record<string, AccessLevel> {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
    const out: Record<string, AccessLevel> = {};
    for (const [name, value] of Object.entries(parsed)) {
      if (value === "everyone" || value === "mods" || value === "broadcaster") out[name] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function writeAccess(access: Record<string, AccessLevel>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(access, null, 2));
}

export function primaryCommand(name: string): string {
  return COMMAND_PRIMARY[name] ?? name;
}

export function getAccess(name: string): AccessLevel {
  const key = primaryCommand(name);
  return readAccess()[key] ?? DEFAULT_ACCESS[key] ?? "everyone";
}

export function setAccess(name: string, who: AccessLevel): AccessLevel {
  const key = primaryCommand(name);
  const access = readAccess();
  access[key] = who;
  writeAccess(access);
  return who;
}

export function canUseLevel(who: AccessLevel, sender: KickActor, broadcaster: KickActor): boolean {
  if (who === "everyone") return true;
  if (who === "mods") return isStaff(sender, broadcaster);
  return sender.user_id === broadcaster.user_id;
}

export function canUseCommand(name: string, sender: KickActor, broadcaster: KickActor): boolean {
  return canUseLevel(getAccess(name), sender, broadcaster);
}

export function parseAccess(value: unknown): AccessLevel {
  if (value === "mods" || value === "broadcaster" || value === "everyone") return value;
  return "everyone";
}
