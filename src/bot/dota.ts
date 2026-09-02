import { clipChat } from "../kick/api.js";
import { ankaraDayStartMs } from "./clock.js";
import { getSettings } from "./settings.js";

const STEAM64_BASE = 76561197960265728n;
const TTL_MS = 45_000;
const HARD_TTL_MS = 10 * 60_000;

export type DotaProfile = {
  key: string;
  who: string;
  accountId: number;
  aliases: string[];
  steam: string;
  opendota: string;
  dotabuff: string;
};

export const DOTA_PROFILES: DotaProfile[] = [
  {
    key: "main",
    who: "mcvckaharamamm main",
    accountId: 117902299,
    aliases: ["main", "mcvck", "mcvc", "mcvckaharamamm", "kaharamamm", "camelamamm", "king"],
    steam: "https://steamcommunity.com/id/camelamamm/",
    opendota: "https://www.opendota.com/players/117902299",
    dotabuff: "https://www.dotabuff.com/players/117902299",
  },
  {
    key: "smurf",
    who: "mcvckaharamamm smurf",
    accountId: 848597875,
    aliases: ["smurf", "smurfu", "first smurf"],
    steam: "https://steamcommunity.com/profiles/76561198808863603/",
    opendota: "https://www.opendota.com/players/848597875",
    dotabuff: "https://www.dotabuff.com/players/848597875",
  },
  {
    key: "kaiser",
    who: "kaiserdoto",
    accountId: 174021731,
    aliases: ["kaiser", "kaiserdoto", "kaiserdota"],
    steam: "https://steamcommunity.com/profiles/76561198134287459/",
    opendota: "https://www.opendota.com/players/174021731",
    dotabuff: "https://www.dotabuff.com/players/174021731",
  },
];

type HeroMap = Record<string, { id?: number; localized_name?: string }>;
let heroes: Record<number, string> = {};

export function parseDotaAccount(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  const vanity = text.match(/steamcommunity\.com\/id\/([A-Za-z0-9_-]+)/i);
  if (vanity?.[1]?.toLowerCase() === "camelamamm") return 117902299;
  const player = text.match(/(?:opendota|dotabuff)\.com\/players\/(\d+)/i);
  if (player?.[1]) return asAccountId(player[1]);
  const profile = text.match(/steamcommunity\.com\/profiles\/(\d+)/i);
  if (profile?.[1]) return asAccountId(profile[1]);
  if (/^\d{5,20}$/.test(text)) return asAccountId(text);
  return null;
}

function asAccountId(value: string): number | null {
  try {
    const n = BigInt(value);
    const id = n > 100000000000n ? n - STEAM64_BASE : n;
    if (id < 1n || id > 5000000000n) return null;
    return Number(id);
  } catch {
    return null;
  }
}

export function steam64FromAccount(accountId: number): string {
  return (BigInt(accountId) + STEAM64_BASE).toString();
}

export function shownDotaProfile(slug: string, args = ""): DotaProfile | null {
  const explicit = explicitProfile(args);
  if (explicit) return explicit;
  const map = getSettings().dotaShownByChannel ?? {};
  const key = map[slug.toLowerCase()] || defaultShownKey(slug);
  if (key === "off") return null;
  return DOTA_PROFILES.find((p) => p.key === key) ?? DOTA_PROFILES[0]!;
}

export function defaultShownKey(slug: string): string {
  const s = slug.toLowerCase();
  if (s.includes("kaiser")) return "kaiser";
  return "main";
}

function explicitProfile(text: string): DotaProfile | null {
  const t = text.trim().toLocaleLowerCase("tr-TR");
  if (!t) return null;
  const exact = DOTA_PROFILES.find((p) => p.key === t || p.aliases.includes(t));
  if (exact) return exact;
  for (const row of DOTA_PROFILES) {
    if (row.key !== "main" && row.aliases.some((a) => t.includes(a))) return row;
  }
  if (DOTA_PROFILES[0]!.aliases.some((a) => t.includes(a))) return DOTA_PROFILES[0]!;
  return null;
}

export function pickDotaProfile(text: string): DotaProfile {
  return explicitProfile(text) ?? DOTA_PROFILES[0]!;
}

export function classifyDotaAsk(content: string): "mmr" | "wl" | "last" | "full" | null {
  const t = content
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!t || t.startsWith("!")) return null;
  if (notAskingForStats(t)) return null;
  if (/(son ma[cç]|son oyun|last (game|match)|lastgame|\blgs\b)/.test(t) && lookingUpStats(t)) return "last";
  if (/\b(win ?loss|winrate|win rate|\bwl\b|kaç w|kac w|rekor)\b/.test(t) && lookingUpStats(t)) return "wl";
  if (asksRank(t)) return "mmr";
  if (/\b(opendota|dotabuff|match ?id|matchid|account id)\b/.test(t)) return "full";
  if (/\b(k\/d|\bkda\b|\bgpm\b|\bxpm\b|hangi hero)\b/.test(t) && /\b(dota|match|ma[cç]|oyun|last|son)\b/.test(t)) {
    return "full";
  }
  const who = /\b(kaiser|kaiserdoto|kaiserdota|smurf|mcvck|mcvc|kaharamamm)\b/.test(t);
  const stat = /\b(mmr|rank|medal|madalya|elo|opendota|dotabuff)\b/.test(t);
  if (who && stat && lookingUpStats(t)) return /\b(mmr|rank|medal|madalya|elo)\b/.test(t) ? "mmr" : "full";
  return null;
}

function notAskingForStats(t: string): boolean {
  return /\b(ne alaka|alakas[ıi] yok|alakasi yok|neyse|whatever|not asking|alakasız|alakasiz)\b/.test(t);
}

function lookingUpStats(t: string): boolean {
  if (notAskingForStats(t)) return false;
  return (
    /(nedir|ne kadar|what is|whats|what.?s|how much|how high|hangi|your|ur|senin|sizin)\b/.test(t) ||
    /(?:^|\s)(kaç|kac)(?:\s|[?.,!]|$)/.test(t) ||
    /\?/.test(t) ||
    /^(mmr|rank|medal|madalya|elo|last ?game|wl|son ma[cç]|son oyun|lgs)\??$/.test(t) ||
    /(mmr|rank|medal|madalya|elo) ne\??$/.test(t)
  );
}

function asksRank(t: string): boolean {
  if (!lookingUpStats(t) && !/^(mmr|rank|medal|madalya|elo)\??$/.test(t)) return false;
  if (/(what.?s|whats|wheres|where is|what is|how much|how high|hangi).{0,32}(mmr|rank|medal|madalya|elo)/.test(t)) {
    return true;
  }
  if (/(what|which) (is )?(your |ur |the )?(mmr|rank|medal|elo)/.test(t)) return true;
  if (/(your|ur|senin|sizin).{0,16}(mmr|rank|medal|madalya|elo)/.test(t)) return true;
  if (/(mmr|rank|medal|madalya|elo).{0,16}(nedir|ne kadar|kaç|kac)(\b|\?|$)/.test(t)) return true;
  if (/(mmr|rank|medal|madalya|elo) ne\??$/.test(t)) return true;
  if (/(kaç|kac).{0,12}(mmr|rank|medal|madalya)/.test(t)) return true;
  if (/mmr.?[ıiüu]n|rank.?[ıiüu]n|medal.?[ıiüu]n|madalya[nıi]/.test(t)) return true;
  if (/rankta[sş][ıi]n|rankda[sş][ıi]n|ne rank/.test(t)) return true;
  if (/^(mmr|rank|medal|madalya|elo)\??$/.test(t)) return true;
  return false;
}

export function isGameStatsQuestion(content: string): boolean {
  return classifyDotaAsk(content) !== null;
}

export async function answerDotaAsk(
  ask: "mmr" | "wl" | "last" | "full",
  slug: string,
  args = "",
  live?: { live: boolean; startedAt?: number },
): Promise<string> {
  if (ask === "mmr") return dotaMmr(slug, args);
  if (ask === "last") return dotaLastGame(slug, args);
  if (ask === "wl") return dotaWl(slug, args, live?.live ? live.startedAt ?? null : null, Boolean(live?.live));
  return dotaCommand(args, slug);
}

export function warmupDota(): void {
  void ensureHeroes();
  for (const profile of DOTA_PROFILES) {
    void loadPlayer(profile.accountId);
    void loadRecent(profile.accountId);
    void steamPlaying(profile.accountId);
  }
}

export function steamApiKeyConfigured(): boolean {
  return Boolean(process.env.STEAM_API_KEY?.trim());
}

export function dotaCommand(args: string, slug = ""): Promise<string> {
  const profile = shownDotaProfile(slug, args);
  if (!profile) return Promise.resolve("");
  return dotaFacts(profile);
}

export async function dotaFactsFor(text: string, slug = ""): Promise<string> {
  const profile = shownDotaProfile(slug, text);
  if (!profile) return "";
  return dotaFacts(profile);
}

export async function dotaMmr(slug: string, args = ""): Promise<string> {
  const profile = shownDotaProfile(slug, args);
  if (!profile) return "";
  const player = await loadPlayer(profile.accountId);
  if (!player) return `${profile.who} · Rank: unknown`;
  return clipChat(formatRankLine(profile, player));
}

export async function dotaMedal(slug: string, args = ""): Promise<string> {
  return dotaMmr(slug, args);
}

export async function dotaLastGame(slug: string, args = ""): Promise<string> {
  const profile = shownDotaProfile(slug, args);
  if (!profile) return "";
  void ensureHeroes();
  const recent = await loadRecent(profile.accountId);
  const last = recent[0];
  if (!last?.match_id) return `${profile.who} · Last match: none on OpenDota`;
  return clipChat(`${profile.who} · ${formatMatch(last)} · https://www.opendota.com/matches/${last.match_id}`);
}

export async function dotaFacts(profile: DotaProfile): Promise<string> {
  void steamPlaying(profile.accountId);
  void ensureHeroes();
  void loadRecent(profile.accountId);
  const player = await loadPlayer(profile.accountId);
  if (!player) return `${profile.who} · OpenDota timeout`;
  const recent = recentCache.get(profile.accountId)?.recent ?? [];
  return clipChat(composeFacts(profile, player, recent));
}

function formatRankLine(profile: DotaProfile, player: Player): string {
  const rank = formatRank(player.rank_tier, player.leaderboard_rank);
  const estimate = player.mmr_estimate?.estimate;
  const mmr = estimate ? ` · MMR estimate ${estimate}` : "";
  return `${profile.who} · Rank: ${rank}${mmr}`;
}

function composeFacts(profile: DotaProfile, player: Player, recent: Recent[]): string {
  const bits = [formatRankLine(profile, player)];
  const game = steamCache.get(profile.accountId)?.game;
  if (game) bits.push(`In-game: ${game}`);
  const last = recent[0];
  if (last?.match_id) {
    bits.push(formatMatch(last));
    bits.push(`https://www.opendota.com/matches/${last.match_id}`);
  }
  return bits.join(" · ");
}

export async function dotaWl(slug: string, args: string, sinceMs: number | null, live: boolean): Promise<string> {
  const profile = shownDotaProfile(slug, args);
  if (!profile) return "";
  const recent = await loadRecent(profile.accountId);
  const since = Math.floor((sinceMs ?? ankaraDayStartMs()) / 1000);
  const label = live && sinceMs ? "this stream" : "today";
  const games = recent.filter((m) => (m.start_time || 0) >= since && (m.duration || 0) >= 60);
  let wins = 0;
  let losses = 0;
  for (const m of games) {
    if (win(m)) wins += 1;
    else losses += 1;
  }
  return clipChat(`${profile.who} · ${label}: ${wins}W-${losses}L (${wins + losses} games)`);
}

const playerCache = new Map<number, { at: number; player: Player | null }>();
const recentCache = new Map<number, { at: number; recent: Recent[] }>();
const steamCache = new Map<number, { at: number; game: string | null }>();
const playerPending = new Map<number, Promise<Player | null>>();
const recentPending = new Map<number, Promise<Recent[]>>();
const steamPending = new Map<number, Promise<string | null>>();

async function loadPlayer(accountId: number, wait = true): Promise<Player | null> {
  const hit = playerCache.get(accountId);
  if (hit && Date.now() - hit.at < HARD_TTL_MS) {
    if (Date.now() - hit.at >= TTL_MS) void refreshPlayer(accountId);
    return hit.player;
  }
  if (!wait) {
    void refreshPlayer(accountId);
    return hit?.player ?? null;
  }
  return refreshPlayer(accountId);
}

async function refreshPlayer(accountId: number): Promise<Player | null> {
  const existing = playerPending.get(accountId);
  if (existing) return existing;
  const job = getJson<Player>(`https://api.opendota.com/api/players/${accountId}`)
    .then((player) => {
      playerCache.set(accountId, { at: Date.now(), player });
      return player;
    })
    .finally(() => playerPending.delete(accountId));
  playerPending.set(accountId, job);
  return job;
}

async function loadRecent(accountId: number, wait = true): Promise<Recent[]> {
  const hit = recentCache.get(accountId);
  if (hit && Date.now() - hit.at < HARD_TTL_MS) {
    if (Date.now() - hit.at >= TTL_MS) void refreshRecent(accountId);
    return hit.recent;
  }
  if (!wait) {
    void refreshRecent(accountId);
    return hit?.recent ?? [];
  }
  return refreshRecent(accountId);
}

async function refreshRecent(accountId: number): Promise<Recent[]> {
  const existing = recentPending.get(accountId);
  if (existing) return existing;
  const job = getJson<Recent[]>(`https://api.opendota.com/api/players/${accountId}/recentMatches`)
    .then((recent) => {
      const list = recent ?? [];
      recentCache.set(accountId, { at: Date.now(), recent: list });
      return list;
    })
    .finally(() => recentPending.delete(accountId));
  recentPending.set(accountId, job);
  return job;
}

function formatMatch(last: Recent): string {
  const side = last.player_slot < 128 ? "Radiant" : "Dire";
  const result = win(last) ? "WIN" : "LOSS";
  const hero = heroes[last.hero_id] ?? `hero_id ${last.hero_id}`;
  return `Last match ${last.match_id} · ${hero} · ${last.kills}/${last.deaths}/${last.assists} · ${side} · ${result} · ${Math.round((last.duration || 0) / 60)}m · ${ago(last.start_time)}`;
}

async function steamPlaying(accountId: number): Promise<string | null> {
  const key = process.env.STEAM_API_KEY?.trim();
  if (!key) return null;
  const hit = steamCache.get(accountId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.game;
  const existing = steamPending.get(accountId);
  if (existing) return existing;
  const job = (async () => {
    try {
      const id = steam64FromAccount(accountId);
      const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(key)}&steamids=${id}`;
      const json = await getJson<{ response?: { players?: Array<{ gameextrainfo?: string; gameid?: string }> } }>(url);
      const game = json?.response?.players?.[0]?.gameextrainfo ?? null;
      steamCache.set(accountId, { at: Date.now(), game });
      return game;
    } catch {
      return null;
    }
  })().finally(() => steamPending.delete(accountId));
  steamPending.set(accountId, job);
  return job;
}

async function ensureHeroes(): Promise<void> {
  if (Object.keys(heroes).length > 0) return;
  try {
    const json = await getJson<HeroMap>("https://api.opendota.com/api/constants/heroes");
    const map: Record<number, string> = {};
    for (const row of Object.values(json ?? {})) {
      const id = Number(row?.id);
      if (id && row?.localized_name) map[id] = row.localized_name;
    }
    heroes = map;
  } catch {
    heroes = {};
  }
}

function formatRank(tier?: number, leaderboard?: number | null): string {
  if (leaderboard && leaderboard > 0) return `Immortal rank ${leaderboard}`;
  if (!tier) return "unknown";
  const medals = ["", "Herald", "Guardian", "Crusader", "Archon", "Legend", "Ancient", "Divine", "Immortal"];
  const medal = medals[Math.floor(tier / 10)] ?? "Unknown";
  const star = tier % 10;
  return star && medal !== "Immortal" ? `${medal} ${star}` : medal;
}

function win(m: Recent): boolean {
  const radiant = m.player_slot < 128;
  return Boolean(m.radiant_win) === radiant;
}

function ago(start?: number): string {
  if (!start) return "unknown time";
  const mins = Math.max(0, Math.round((Date.now() / 1000 - start) / 60));
  if (mins < 90) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(3500),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

type Player = {
  rank_tier?: number;
  leaderboard_rank?: number | null;
  mmr_estimate?: { estimate?: number };
  profile?: { personaname?: string };
};

type Recent = {
  match_id?: number;
  hero_id: number;
  kills: number;
  deaths: number;
  assists: number;
  duration: number;
  start_time: number;
  player_slot: number;
  radiant_win?: boolean;
};
