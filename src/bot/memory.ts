import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { lookupKickCard } from "../kick/publicChannel.js";
import type { KickActor } from "../types.js";

const path = join(fileURLToPath(new URL(".", import.meta.url)), "../../data/memory.json");
const MAX_PEOPLE = 250;
const KING_ID = 549839;
const MIN_LINES_FOR_SUMMARY = 5;
const LORE_OTHERS = [
  "rareakuma",
  "rarekuma",
  "sjoe",
  "sjoehrkamr",
  "kaiserdoto",
];

type Person = {
  username: string;
  nick?: string;
  bio?: string;
  summary: string;
  lastAt: number;
  lastSummaryAt: number;
};

const people = new Map<number, Person>();
const buffers = new Map<number, string[]>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();
let loaded = false;
let writing = false;

function hydrate(): void {
  if (loaded) return;
  loaded = true;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, Person>;
    for (const [id, row] of Object.entries(parsed)) {
      const n = Number(id);
      if (n && row?.username) {
        row.summary = tidyStoredSummary(row.username, row.summary ?? "", n, row.nick);
        people.set(n, row);
      }
    }
  } catch {
    // first run
  }
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function knownOthers(exceptUsername: string, exceptNick?: string): string[] {
  const skip = new Set(
    [exceptUsername, exceptNick].filter(Boolean).map((n) => n!.toLowerCase()),
  );
  const names = new Set(LORE_OTHERS);
  for (const row of people.values()) {
    names.add(row.username.toLowerCase());
    if (row.nick) names.add(row.nick.toLowerCase());
  }
  return [...names].filter((n) => n.length >= 3 && !skip.has(n));
}

function mentionsAny(text: string, names: string[]): boolean {
  return names.some((n) => new RegExp(`\\b${escapeRe(n)}\\b`, "i").test(text));
}

function dropOtherPeople(text: string, others: string[]): string {
  const parts = text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);
  return parts.filter((part) => !mentionsAny(part, others)).join(" ").trim();
}

function tidyStoredSummary(username: string, summary: string, userId: number, nick?: string, sourceText = ""): string {
  let s = summary.replace(/\s+/g, " ").trim();
  for (const name of [username, nick].filter(Boolean) as string[]) {
    s = s.replace(new RegExp(`^@?${escapeRe(name)}\\s*[:\\-]\\s*`, "i"), "");
  }
  const others = knownOthers(username, nick);
  const allowed = new Set(others.filter((n) => new RegExp(`\\b${escapeRe(n)}\\b`, "i").test(sourceText)));
  const banned = userId === KING_ID ? others : others.filter((n) => !allowed.has(n));
  s = dropOtherPeople(s, banned);
  if (userId === KING_ID && /stay calm|chill out|telling everyone to stay calm/i.test(s)) {
    s = "Streamer. Camel king persona. Often chats in Turkish.";
  }
  return s.slice(0, 240);
}

function persist(): void {
  if (writing) return;
  writing = true;
  setTimeout(() => {
    writing = false;
    hydrate();
    const out: Record<string, Person> = {};
    const rows = [...people.entries()].sort((a, b) => b[1].lastAt - a[1].lastAt).slice(0, MAX_PEOPLE);
    for (const [id, row] of rows) {
      out[String(id)] = {
        ...row,
        summary: tidyStoredSummary(row.username, row.summary ?? "", id, row.nick),
      };
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(out));
  }, 1500);
}

export function listPeople(): Array<{
  userId: number;
  username: string;
  nick?: string;
  bio?: string;
  summary: string;
  lastAt: number;
}> {
  hydrate();
  return [...people.entries()]
    .sort((a, b) => b[1].lastAt - a[1].lastAt)
    .map(([userId, row]) => ({
      userId,
      username: row.username,
      nick: row.nick,
      bio: row.bio,
      summary: row.summary,
      lastAt: row.lastAt,
    }));
}

export function personNote(userId: number): string {
  hydrate();
  const row = people.get(userId);
  if (!row) return "";
  return [row.nick && row.nick !== row.username ? `Nick: ${row.nick}` : "", row.bio ? `Bio: ${row.bio}` : "", row.summary]
    .filter(Boolean)
    .join(" · ");
}

/** Pre-load lore for known Discord/Kick identities (does not overwrite a longer learned summary). */
export function seedPersonMemory(userId: number, username: string, summary: string, nick?: string): void {
  if (!userId) return;
  hydrate();
  const existing = people.get(userId);
  const seed = summary.replace(/\s+/g, " ").trim().slice(0, 240);
  people.set(userId, {
    username,
    nick: nick ?? existing?.nick ?? username,
    bio: existing?.bio,
    summary: existing?.summary && existing.summary.length >= seed.length ? existing.summary : seed,
    lastAt: Date.now(),
    lastSummaryAt: existing?.lastSummaryAt ?? 0,
  });
  persist();
}

export function rememberPerson(actor: KickActor, lastText?: string): void {
  if (!actor.user_id) return;
  hydrate();
  if (lastText?.trim()) queueSummary(actor, lastText);
}

export function noteExchange(userId: number, username: string, userText: string, _botText?: string): void {
  if (!userId || !userText.trim()) return;
  rememberPerson({ user_id: userId, username }, userText);
}

function queueSummary(actor: KickActor, userText: string): void {
  const buf = buffers.get(actor.user_id) ?? [];
  buf.push(userText.replace(/\s+/g, " ").trim().slice(0, 160));
  if (buf.length > 12) buf.splice(0, buf.length - 12);
  buffers.set(actor.user_id, buf);
  const existing = people.get(actor.user_id);
  const unique = new Set(buf.map((line) => line.toLowerCase())).size;
  if (!existing?.summary && unique < MIN_LINES_FOR_SUMMARY) return;
  upsertPerson(actor);
  scheduleSummary(actor.user_id);
}

function upsertPerson(actor: KickActor): void {
  const existing = people.get(actor.user_id);
  people.set(actor.user_id, {
    username: actor.username,
    nick: existing?.nick || actor.username,
    bio: existing?.bio,
    summary: existing?.summary ?? "",
    lastAt: Date.now(),
    lastSummaryAt: existing?.lastSummaryAt ?? 0,
  });
  persist();
  if (!existing?.bio) void enrichBio(actor.user_id, actor.username);
}

function scheduleSummary(userId: number): void {
  const prev = timers.get(userId);
  if (prev) clearTimeout(prev);
  timers.set(
    userId,
    setTimeout(() => {
      timers.delete(userId);
      void summarize(userId);
    }, 8_000),
  );
}

async function enrichBio(userId: number, username: string): Promise<void> {
  try {
    const card = await lookupKickCard(username);
    if (!card.bio && !card.nick) return;
    hydrate();
    const row = people.get(userId);
    if (!row) return;
    if (card.nick) row.nick = card.nick;
    if (card.bio) row.bio = card.bio.slice(0, 180);
    people.set(userId, row);
    persist();
  } catch {
    // no public Kick card
  }
}

async function summarize(userId: number): Promise<void> {
  const buf = buffers.get(userId);
  const row = people.get(userId);
  if (!buf || !row) return;
  if (!row.summary && buf.length < MIN_LINES_FOR_SUMMARY) return;
  if (Date.now() - row.lastSummaryAt < 45_000) return;
  row.lastSummaryAt = Date.now();
  people.set(userId, row);

  const ownLines = buf.slice(-8);
  if (ownLines.length === 0) return;

  const source = ownLines.join(" ");
  const prev = tidyStoredSummary(row.username, row.summary ?? "", userId, row.nick, source);
  const { generateRaw } = await import("./ai.js");
  const raw = await generateRaw(
    [
      `Subject: Kick chatter "${row.nick || row.username}" (id ${userId}).`,
      row.bio ? `Their Kick bio: ${row.bio}` : "",
      prev ? `Existing note about this person only: ${prev}` : "No previous note.",
      `ONLY this person's own chat lines:\n${ownLines.map((l) => `- ${l}`).join("\n")}`,
      "Write one compact English operator note under 180 characters about THIS person: lasting traits, how they usually talk, roastable bits from THEIR lines or bio.",
      "Do not treat one-off orders to the bot (calm down, sakin ol, answer me, shut up) as personality.",
      "Do not mash unrelated lines into one story. If they greeted chat, that is not 'telling everyone to stay calm'.",
      "Do not mention other chatters. Do not copy streamer lore, Dota heroes, Meepo, or hair jokes unless THIS person said those things about themselves.",
      "Do not start with the username. Do not write Turkish.",
    ]
      .filter(Boolean)
      .join("\n"),
    "You write private English memory notes. One person only. Plain text. No username prefix. Never mention other people unless they are the subject. Never use real/legal names.",
    { standalone: true },
  );
  if (!raw) return;
  const cleaned = tidyStoredSummary(row.username, cleanSummary(raw, row.username, row.nick), userId, row.nick, source);
  if (!cleaned) return;
  row.summary = cleaned;
  row.lastAt = Date.now();
  people.set(userId, row);
  persist();
}

function cleanSummary(raw: string, username: string, nick?: string): string {
  let s = raw.replace(/\s+/g, " ").trim();
  for (const name of [username, nick].filter(Boolean) as string[]) {
    s = s.replace(new RegExp(`^@?${escapeRe(name)}\\s*[:\\-]\\s*`, "i"), "");
  }
  return s.slice(0, 240);
}
