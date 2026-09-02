import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { looksLikeBotInsult } from "./heat.js";
import type { ChatLang } from "./lang.js";

const path = join(fileURLToPath(new URL(".", import.meta.url)), "../../data/recap.json");
const KING_ID = 549839;
const KING_NAME = "mcvckaharamamm";
const SJOE_NAME = "SjoeHrkamr";
const MAX_CHATTERS = 80;

type Named = { username: string; at: number };
type Sub = Named & { months?: number };
type Raid = Named & { viewers?: number };
type Talk = Named & { userId: number; text: string };
type Donation = Named & { amount?: string; kicks?: number };

type Chatter = {
  username: string;
  userId: number;
  lines: number;
  emotes: number;
  emoteCounts: Record<string, number>;
  compliments: number;
  insults: number;
  gifts: number;
  lastAt: number;
};

type GameSlice = { name: string; ms: number };

type Recap = {
  lastFollow?: Named;
  lastSub?: Sub;
  lastRaid?: Raid;
  lastTalk?: Talk;
  lastDonation?: Donation;
  streamStartedAt?: number;
  mood: number;
  moodAt: number;
  chatters: Record<string, Chatter>;
  games: GameSlice[];
  currentGame?: string;
  gameSince?: number;
};

export type RecapKind =
  | "follow"
  | "sub"
  | "raid"
  | "talk"
  | "donation"
  | "chatter"
  | "best"
  | "worst"
  | "emote"
  | "game"
  | "mood";

export type RecapSnapshot = {
  mood: { score: number; label: string };
  lastFollow?: Named;
  lastSub?: Sub;
  lastRaid?: Raid;
  lastTalk?: Talk;
  lastDonation?: Donation;
  best: { username: string; why: string };
  worst: { username: string; why: string };
  topChatters: Array<{ username: string; lines: number; emotes: number }>;
  emoteSpammer?: { username: string; emote: string; count: number };
  games: Array<{ name: string; ms: number; current: boolean }>;
  streamStartedAt?: number;
};

const EMPTY: Recap = { mood: 0, moodAt: 0, chatters: {}, games: [] };

let recap: Recap = { ...EMPTY };
let loaded = false;
let writing = false;

function hydrate(): void {
  if (loaded) return;
  loaded = true;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<Recap>;
    recap = {
      ...EMPTY,
      ...parsed,
      mood: clampMood(Number(parsed.mood) || 0),
      moodAt: Number(parsed.moodAt) || 0,
      chatters: parsed.chatters && typeof parsed.chatters === "object" ? parsed.chatters : {},
      games: Array.isArray(parsed.games) ? parsed.games : [],
    };
  } catch {
    recap = { ...EMPTY };
  }
}

function persist(): void {
  if (writing) return;
  writing = true;
  setTimeout(() => {
    writing = false;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(recap));
  }, 400);
}

function clampMood(n: number): number {
  return Math.max(-100, Math.min(100, Math.round(n)));
}

function decayMood(): void {
  const last = recap.moodAt || Date.now();
  const steps = Math.floor((Date.now() - last) / 180_000);
  if (steps <= 0) return;
  const mood = recap.mood || 0;
  if (mood > 0) recap.mood = Math.max(0, mood - steps);
  else if (mood < 0) recap.mood = Math.min(0, mood + steps);
  recap.moodAt = Date.now();
}

function bumpMood(delta: number): void {
  decayMood();
  recap.mood = clampMood((recap.mood || 0) + delta);
  recap.moodAt = Date.now();
}

function isSjoe(name: string): boolean {
  return /sjoe/i.test(name);
}

function moodLabel(score: number): string {
  if (score >= 40) return "hyped";
  if (score >= 12) return "chill";
  if (score >= -12) return "neutral";
  if (score >= -40) return "salty";
  return "pissed";
}

function ensureSession(startedAt?: number, live?: boolean): void {
  hydrate();
  if (!live || !startedAt) return;
  if (recap.streamStartedAt && recap.streamStartedAt !== startedAt) {
    resetSessionInner(startedAt);
  } else if (!recap.streamStartedAt) {
    recap.streamStartedAt = startedAt;
  }
}

function resetSessionInner(startedAt?: number): void {
  recap.streamStartedAt = startedAt;
  recap.chatters = {};
  recap.games = [];
  recap.currentGame = undefined;
  recap.gameSince = undefined;
  recap.mood = clampMood((recap.mood || 0) / 2);
  recap.moodAt = Date.now();
}

export function resetStreamStats(): void {
  hydrate();
  resetSessionInner(recap.streamStartedAt);
  persist();
}

export function noteStreamContext(game?: string, startedAt?: number, live?: boolean): void {
  ensureSession(startedAt, live);
  if (!live) return;
  const name = (game || "").replace(/\s+/g, " ").trim();
  if (!name) return;
  const now = Date.now();
  if (recap.currentGame === name) return;
  if (recap.currentGame && recap.gameSince) {
    recap.games.push({ name: recap.currentGame, ms: Math.max(0, now - recap.gameSince) });
  }
  recap.currentGame = name;
  recap.gameSince = now;
  persist();
}

export function noteFollow(username: string): void {
  const who = cleanName(username);
  if (!who) return;
  hydrate();
  recap.lastFollow = { username: who, at: Date.now() };
  persist();
}

export function noteSub(username: string, months?: number): void {
  const who = cleanName(username);
  if (!who) return;
  hydrate();
  recap.lastSub = { username: who, at: Date.now(), months };
  bumpGifts(who, months && months > 1 ? 2 : 1);
  bumpMood(10);
  persist();
}

export function noteRaid(username: string, viewers?: number): void {
  const who = cleanName(username);
  if (!who || /^(raiders|someone)$/i.test(who)) return;
  hydrate();
  recap.lastRaid = { username: who, at: Date.now(), viewers };
  persist();
}

export function noteDonation(username: string, amount?: string, kicks?: number): void {
  const who = cleanName(username);
  if (!who) return;
  hydrate();
  recap.lastDonation = { username: who, at: Date.now(), amount: amount?.trim() || undefined, kicks };
  bumpGifts(who, kicks && kicks > 0 ? Math.min(8, Math.ceil(kicks / 50) || 1) : 3);
  bumpMood(18);
  persist();
}

export function noteTalkedToUs(username: string, userId: number, text: string): void {
  const who = cleanName(username);
  if (!who) return;
  hydrate();
  recap.lastTalk = {
    username: who,
    userId,
    text: readableChat(text).slice(0, 500),
    at: Date.now(),
  };
  persist();
}

export function noteChat(params: {
  username: string;
  userId: number;
  text: string;
  raw: string;
  home: boolean;
  emotes?: unknown;
}): void {
  if (!params.home || !params.userId) return;
  hydrate();
  decayMood();
  const row = getChatter(params.userId, params.username);
  row.lines += 1;
  row.lastAt = Date.now();
  row.username = params.username;
  const emotes = [
    ...extractEmotes(params.raw, params.text),
    ...namesFromEmotesField(params.emotes),
  ];
  row.emotes += emotes.length;
  for (const emote of emotes) {
    row.emoteCounts[emote] = (row.emoteCounts[emote] ?? 0) + 1;
  }
  const text = `${params.text} ${params.raw}`;
  if (looksLikeBotInsult(text) || looksLikeBotInsult(params.text)) {
    row.insults += 1;
    bumpMood(-10);
  } else if (looksLikeBotNice(params.text)) {
    row.compliments += 1;
    bumpMood(8);
  }
  trimChatters();
  persist();
}

function bumpGifts(username: string, amount: number): void {
  const who = username.toLowerCase();
  let row = Object.values(recap.chatters).find((c) => c.username.toLowerCase() === who);
  if (!row) {
    const key = `n:${who}`;
    recap.chatters[key] = {
      username,
      userId: 0,
      lines: 0,
      emotes: 0,
      emoteCounts: {},
      compliments: 0,
      insults: 0,
      gifts: 0,
      lastAt: Date.now(),
    };
    row = recap.chatters[key]!;
  }
  row.gifts += amount;
  row.lastAt = Date.now();
}

function getChatter(userId: number, username: string): Chatter {
  const key = String(userId);
  const existing = recap.chatters[key];
  if (existing) {
    const orphan = recap.chatters[`n:${username.toLowerCase()}`];
    if (orphan && orphan !== existing) {
      existing.gifts += orphan.gifts;
      existing.compliments += orphan.compliments;
      delete recap.chatters[`n:${username.toLowerCase()}`];
    }
    return existing;
  }
  const row: Chatter = {
    username,
    userId,
    lines: 0,
    emotes: 0,
    emoteCounts: {},
    compliments: 0,
    insults: 0,
    gifts: 0,
    lastAt: Date.now(),
  };
  recap.chatters[key] = row;
  return row;
}

function trimChatters(): void {
  const rows = Object.entries(recap.chatters);
  if (rows.length <= MAX_CHATTERS) return;
  rows
    .sort((a, b) => chatterScore(a[1]) - chatterScore(b[1]) || a[1].lastAt - b[1].lastAt)
    .slice(0, rows.length - MAX_CHATTERS)
    .forEach(([key]) => {
      delete recap.chatters[key];
    });
}

function extractEmotes(raw: string, text: string): string[] {
  const found: string[] = [];
  const blob = `${raw}\n${text}`;
  for (const m of blob.matchAll(/\[emote:([^:\]]+):([^\]]+)\]/gi)) {
    const a = m[1]?.trim() ?? "";
    const b = m[2]?.trim() ?? "";
    const name = /^\d+$/.test(a) ? b : a;
    if (name) found.push(name.replace(/:$/, ""));
  }
  for (const m of blob.matchAll(/(?:^|[\s])[:;]([A-Za-z][\w]{1,24})[:;]/g)) {
    const name = m[1];
    if (name && !/^(http|https|www)$/i.test(name)) found.push(name);
  }
  const emoji = blob.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}😂🤣😭💀❤️🔥]/gu) ?? [];
  found.push(...emoji);
  return found.slice(0, 80);
}

function namesFromEmotesField(emotes: unknown): string[] {
  if (!Array.isArray(emotes)) return [];
  const out: string[] = [];
  for (const e of emotes) {
    if (typeof e === "string" && e.trim()) out.push(e.trim());
    else if (e && typeof e === "object") {
      const o = e as { name?: string; emote?: string; code?: string; id?: string | number };
      const n = o.name || o.emote || o.code;
      if (n) out.push(String(n));
    }
  }
  return out;
}

function readableChat(text: string): string {
  return text
    .replace(/\[emote:([^:\]]+):([^\]]+)\]/gi, (_all, a: string, b: string) => {
      const name = /^\d+$/.test(a) ? b : a;
      return `:${name}:`;
    })
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeBotNice(text: string): boolean {
  const t = text.toLowerCase();
  if (/(good bot|nice bot|best bot|love you (bot|camel)|based camel|aferin bot|helal bot|iyi bot)/i.test(t)) {
    return true;
  }
  return (
    /(thanks|teşekkür|tesekkur|sağ ol|sagol|seni seviyorum|love you|helal|aferin)/i.test(t) &&
    /(bot|camel)/i.test(t)
  );
}

function chatterScore(c: Chatter): number {
  let s = c.lines * 1.2 + c.emotes * 0.12 + c.compliments * 14 + c.gifts * 28 - c.insults * 22;
  if (c.userId === KING_ID || c.username.toLowerCase() === KING_NAME) s += 55;
  if (isSjoe(c.username)) s -= 48;
  return s;
}

function allChatters(): Chatter[] {
  hydrate();
  decayMood();
  const rows = Object.values(recap.chatters);
  const names = new Set(rows.map((c) => c.username.toLowerCase()));
  if (![...names].some((n) => n === KING_NAME)) {
    rows.push({
      username: KING_NAME,
      userId: KING_ID,
      lines: 0,
      emotes: 0,
      emoteCounts: {},
      compliments: 0,
      insults: 0,
      gifts: 0,
      lastAt: 0,
    });
  }
  if (![...names].some((n) => isSjoe(n))) {
    rows.push({
      username: SJOE_NAME,
      userId: 0,
      lines: 0,
      emotes: 0,
      emoteCounts: {},
      compliments: 0,
      insults: 0,
      gifts: 0,
      lastAt: 0,
    });
  }
  return rows;
}

function pickBest(): { username: string; why: string; tr: string } {
  const ranked = allChatters().sort((a, b) => chatterScore(b) - chatterScore(a));
  const c = ranked[0] ?? { username: KING_NAME, userId: KING_ID, lines: 0, emotes: 0, emoteCounts: {}, compliments: 0, insults: 0, gifts: 0, lastAt: 0 };
  if (c.gifts >= 1) {
    return {
      username: c.username,
      why: "Gifted or subbed this stream.",
      tr: "Bu yayında hediye/sub attı.",
    };
  }
  if (c.compliments >= 2) {
    return {
      username: c.username,
      why: `Actually nice to me (${c.compliments}x).`,
      tr: `Bana gerçekten iyi davrandı (${c.compliments} kez).`,
    };
  }
  if (c.userId === KING_ID || c.username.toLowerCase() === KING_NAME) {
    return {
      username: KING_NAME,
      why: "He built me. Still his.",
      tr: "O yaptı beni. Hâlâ onunki.",
    };
  }
  if (c.lines >= 8) {
    return {
      username: c.username,
      why: `Keeping chat alive (${c.lines} lines).`,
      tr: `Chati ayakta tutuyor (${c.lines} mesaj).`,
    };
  }
  return {
    username: c.username,
    why: "Showing up.",
    tr: "Ortalıkta.",
  };
}

function pickWorst(): { username: string; why: string; tr: string } {
  const ranked = allChatters().sort((a, b) => chatterScore(a) - chatterScore(b));
  const c = ranked[0] ?? { username: SJOE_NAME, userId: 0, lines: 0, emotes: 0, emoteCounts: {}, compliments: 0, insults: 0, gifts: 0, lastAt: 0 };
  if (c.insults >= 1) {
    return {
      username: c.username,
      why: `Roasted me ${c.insults}x.`,
      tr: `Bana ${c.insults} kez salladı.`,
    };
  }
  if (isSjoe(c.username)) {
    return {
      username: SJOE_NAME,
      why: "Maldest man alive. No hair, all tilt.",
      tr: "Maldest man alive. Saç yok, sinir var.",
    };
  }
  if (c.emotes > Math.max(6, c.lines * 2)) {
    const emote = topEmote(c);
    return {
      username: c.username,
      why: `Emote spamming ${emote || "emotes"}.`,
      tr: `${emote || "Emote"} spamlıyor.`,
    };
  }
  return {
    username: c.username,
    why: "Worst vibe in chat right now.",
    tr: "Şu an en kötü aura.",
  };
}

function moodTr(label: string): string {
  if (label === "hyped") return "coşkulu";
  if (label === "chill") return "rahat";
  if (label === "salty") return "sinirli";
  if (label === "pissed") return "kızgın";
  return "nötr";
}

function topEmote(c: Chatter): string {
  let best = "";
  let n = 0;
  for (const [name, count] of Object.entries(c.emoteCounts)) {
    if (count > n) {
      best = name;
      n = count;
    }
  }
  return best;
}

function gameTotals(): Array<{ name: string; ms: number; current: boolean }> {
  hydrate();
  const now = Date.now();
  const map = new Map<string, number>();
  for (const slice of recap.games) {
    map.set(slice.name, (map.get(slice.name) ?? 0) + slice.ms);
  }
  if (recap.currentGame && recap.gameSince) {
    map.set(recap.currentGame, (map.get(recap.currentGame) ?? 0) + Math.max(0, now - recap.gameSince));
  }
  return [...map.entries()]
    .map(([name, ms]) => ({ name, ms, current: name === recap.currentGame }))
    .sort((a, b) => b.ms - a.ms);
}

function topChatterList(): Array<{ username: string; lines: number; emotes: number }> {
  return Object.values(recap.chatters)
    .filter((c) => c.userId > 0 && c.lines > 0)
    .sort((a, b) => b.lines - a.lines || b.emotes - a.emotes)
    .slice(0, 12)
    .map((c) => ({ username: c.username, lines: c.lines, emotes: c.emotes }));
}

function emoteSpammer(): RecapSnapshot["emoteSpammer"] {
  let best: Chatter | undefined;
  for (const c of Object.values(recap.chatters)) {
    if (c.userId <= 0 || c.emotes <= 0) continue;
    if (!best || c.emotes > best.emotes) best = c;
  }
  if (!best) return undefined;
  const emote = topEmote(best);
  const count = emote ? best.emoteCounts[emote] ?? best.emotes : best.emotes;
  return { username: best.username, emote: emote || "emotes", count };
}

export function recapSnapshot(): RecapSnapshot {
  hydrate();
  decayMood();
  const best = pickBest();
  const worst = pickWorst();
  return {
    mood: { score: recap.mood || 0, label: moodLabel(recap.mood || 0) },
    lastFollow: recap.lastFollow,
    lastSub: recap.lastSub,
    lastRaid: recap.lastRaid,
    lastTalk: recap.lastTalk,
    lastDonation: recap.lastDonation,
    best: { username: best.username, why: best.why },
    worst: { username: worst.username, why: worst.why },
    topChatters: topChatterList(),
    emoteSpammer: emoteSpammer(),
    games: gameTotals(),
    streamStartedAt: recap.streamStartedAt,
  };
}

export function currentMood(): { score: number; label: string; weight: number } {
  hydrate();
  decayMood();
  const score = recap.mood || 0;
  return {
    score,
    label: moodLabel(score),
    weight: Math.round((1 + Math.abs(score) / 80) * 100) / 100,
  };
}

export function recapFacts(): string {
  const s = recapSnapshot();
  const bits = [
    `Mood: ${s.mood.label} (${s.mood.score})`,
    `Last follow: ${s.lastFollow?.username ?? "none"}`,
    `Last sub: ${s.lastSub?.username ?? "none"}`,
    `Last donation: ${s.lastDonation ? `${s.lastDonation.username}${s.lastDonation.amount ? ` ${s.lastDonation.amount}` : ""}${s.lastDonation.kicks ? ` ${s.lastDonation.kicks} kicks` : ""}` : "none"}`,
    `Last raid: ${s.lastRaid?.username ?? "none"}`,
    `Best person: ${s.best.username} (${s.best.why})`,
    `Worst person: ${s.worst.username} (${s.worst.why})`,
    s.topChatters[0] ? `Top chatter: ${s.topChatters[0].username} (${s.topChatters[0].lines} lines)` : "Top chatter: none yet",
    s.emoteSpammer
      ? `Top emote spam: ${s.emoteSpammer.username} spamming ${s.emoteSpammer.emote} (${s.emoteSpammer.count})`
      : "Top emote spam: none yet",
    s.games[0] ? `Most played this stream: ${s.games[0].name}` : "Most played this stream: none yet",
  ];
  return bits.join(" | ");
}

export function classifyRecapAsk(content: string): RecapKind | null {
  const t = content.toLowerCase().replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (/\b(moodun|modun nas[iı]l|how do you feel|how's your mood|how are you feeling)\b/i.test(t)) return "mood";
  if (
    /(en çok|en cok).{0,24}(nefret|sevmiyor|hate)|who do you hate|kimi (nefret|sevmiyorsun)|nefret etti[gğ]in|en nefret|hate the most|worst person|en k[öo]t[üu] (kişi|kisi|adam|insan)/i.test(
      t,
    )
  ) {
    return "worst";
  }
  if (
    /(en çok|en cok).{0,24}(seviyor|aşık|asik)|who do you love|kimi seviyorsun|en sevdi[gğ]in|love the most|best person|en iyi (kişi|kisi|adam|insan)/i.test(
      t,
    )
  ) {
    return "best";
  }
  if (
    /(son|last|en son).{0,28}(follow|follower|takipçi|takipci)|kim follow|who (just )?followed|last follow/i.test(t)
  ) {
    return "follow";
  }
  if (/(son|last|en son).{0,28}(sub|abone)|kim sub|who (just )?subbed|last sub/i.test(t)) return "sub";
  if (
    /(son|last|en son).{0,28}(donat|bağış|bagis|kicks)|who donated|last donat|kim (donate|bağış|bagis)|who tipped/i.test(
      t,
    )
  ) {
    return "donation";
  }
  if (/(son|last|en son).{0,28}(raid|bask[iı]n)|kim raid|who raided|last raid/i.test(t)) return "raid";
  if (
    /top (chatter|chat)|en (çok|cok) yazan|en aktif|who talks the most|kim en çok (yaz|konuş|konus)/i.test(t)
  ) {
    return "chatter";
  }
  if (
    /emote spam|kim emote|top emote|en (çok|cok) emote|which emote|hangi emote|who('s| is) spamming/i.test(t)
  ) {
    return "emote";
  }
  if (
    /(this stream|bu yay[iı]n).{0,40}(game|oyun|category|kategori)|most played|en (çok|cok) oynanan|hangi oyun.*(yay[iı]n|stream)|en uzun.*(oyun|kategori)/i.test(
      t,
    )
  ) {
    return "game";
  }
  if (
    /sana kim yazd|kim yazd[ıi] sana|kiminle konu[sş]tun|who wrote you|who (last )?(talked|messaged|wrote) (to )?you|en son kim.*(konu[sş]|yazd)|last (person|one|chatter) who (talked|wrote)/i.test(
      t,
    )
  ) {
    return "talk";
  }
  return null;
}

export function answerRecap(kind: RecapKind | null, lang: ChatLang): string {
  if (!kind) return "";
  hydrate();
  decayMood();
  const tr = lang === "tr";
  const s = recapSnapshot();
  if (kind === "mood") {
    return tr
      ? `Modum ${moodTr(s.mood.label)} (${s.mood.score}).`
      : `I'm ${s.mood.label} (${s.mood.score}).`;
  }
  if (kind === "best") {
    const b = pickBest();
    return tr ? `En iyisi ${b.username}. ${b.tr}` : `Best person: ${b.username}. ${b.why}`;
  }
  if (kind === "worst") {
    const w = pickWorst();
    return tr ? `En kötüsü ${w.username}. ${w.tr}` : `Worst person: ${w.username}. ${w.why}`;
  }
  if (kind === "follow") {
    const row = recap.lastFollow;
    if (!row) return tr ? "Henüz bir follow kaydetmedim." : "No follow recorded yet.";
    return tr
      ? `Son follow: ${row.username} (${ago(row.at, true)}).`
      : `Last follow: ${row.username} (${ago(row.at, false)}).`;
  }
  if (kind === "sub") {
    const row = recap.lastSub;
    if (!row) return tr ? "Henüz bir sub kaydetmedim." : "No sub recorded yet.";
    const months = row.months && row.months > 1 ? ` ${row.months} ay` : "";
    return tr
      ? `Son sub: ${row.username}${months} (${ago(row.at, true)}).`
      : `Last sub: ${row.username}${row.months && row.months > 1 ? ` (${row.months} months)` : ""} (${ago(row.at, false)}).`;
  }
  if (kind === "donation") {
    const row = recap.lastDonation;
    if (!row) return tr ? "Henüz bir bağış kaydetmedim." : "No donation recorded yet.";
    const extra = row.amount ? ` ${row.amount}` : row.kicks ? ` ${row.kicks} kicks` : "";
    return tr
      ? `Son bağış: ${row.username}${extra} (${ago(row.at, true)}).`
      : `Last donation: ${row.username}${extra} (${ago(row.at, false)}).`;
  }
  if (kind === "raid") {
    const row = recap.lastRaid;
    if (!row) return tr ? "Henüz bir raid kaydetmedim." : "No raid recorded yet.";
    const n = row.viewers ? ` ${row.viewers} kişiyle` : "";
    return tr
      ? `Son raid: ${row.username}${n} (${ago(row.at, true)}).`
      : `Last raid: ${row.username}${row.viewers ? ` with ${row.viewers}` : ""} (${ago(row.at, false)}).`;
  }
  if (kind === "chatter") {
    const top = s.topChatters[0];
    if (!top) return tr ? "Bu yayında henüz chatter saymadım." : "No chatters counted this stream yet.";
    return tr
      ? `En çok yazan: ${top.username} (${top.lines} mesaj).`
      : `Top chatter: ${top.username} (${top.lines} lines).`;
  }
  if (kind === "emote") {
    const row = s.emoteSpammer;
    if (!row) return tr ? "Bu yayında emote spam yok henüz." : "No emote spammer this stream yet.";
    return tr
      ? `Emote kralı: ${row.username} — ${row.emote} (${row.count}x).`
      : `Top emote spammer: ${row.username} spamming ${row.emote} (${row.count}x).`;
  }
  if (kind === "game") {
    const row = s.games[0];
    if (!row) return tr ? "Bu yayında henüz oyun kaydı yok." : "No game recorded this stream yet.";
    return tr
      ? `Bu yayında en çok oynanan: ${row.name} (${dur(row.ms, true)}).`
      : `Most played this stream: ${row.name} (${dur(row.ms, false)}).`;
  }
  const row = recap.lastTalk;
  if (!row) return tr ? "Bana henüz kimse yazmadı, yalnız deve." : "Nobody's written to me yet. Lonely camel.";
  return tr
    ? `En son ${row.username} yazdı: "${row.text}" (${ago(row.at, true)}).`
    : `Last person who wrote to me: ${row.username} — "${row.text}" (${ago(row.at, false)}).`;
}

export function formatRecapAgo(at: number): string {
  return ago(at, false);
}

export function formatRecapDur(ms: number): string {
  return dur(ms, false);
}

function cleanName(username: string): string {
  return username.replace(/^@/, "").trim();
}

function ago(at: number, tr: boolean): string {
  const s = Math.max(1, Math.round((Date.now() - at) / 1000));
  if (s < 60) return tr ? `${s} sn önce` : `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return tr ? `${m} dk önce` : `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return tr ? `${h} sa önce` : `${h}h ago`;
  const d = Math.round(h / 24);
  return tr ? `${d} gün önce` : `${d}d ago`;
}

function dur(ms: number, tr: boolean): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 60) return tr ? `${m} dk` : `${m}m`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (rest === 0) return tr ? `${h} sa` : `${h}h`;
  return tr ? `${h} sa ${rest} dk` : `${h}h ${rest}m`;
}
