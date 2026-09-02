import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getChannelBySlug } from "./api.js";

const execFileAsync = promisify(execFile);
const TTL_MS = 45_000;
const cache = new Map<string, { at: number; data: PublicChannel }>();
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export class ChannelNotFoundError extends Error {
  constructor(slug: string) {
    super(`No Kick channel named "${slug}"`);
    this.name = "ChannelNotFoundError";
  }
}

export type PublicChannel = {
  slug: string;
  userId: number;
  chatroomId: number;
  title: string;
  game: string;
  live: boolean;
  startedAt?: number;
};

type KickV2 = {
  user_id?: number;
  livestream?: {
    session_title?: string;
    created_at?: string;
    start_time?: string;
    started_at?: string;
    categories?: Array<{ name?: string }>;
  } | null;
  previous_livestream?: { session_title?: string; categories?: Array<{ name?: string }> } | null;
  recent_categories?: Array<{ name?: string }>;
  chatroom?: { id?: number };
  message?: string;
  user?: { username?: string; bio?: string };
};

export async function lookupPublicChannel(slug: string): Promise<PublicChannel> {
  const key = slug.toLowerCase().trim();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;

  let official: Awaited<ReturnType<typeof getChannelBySlug>> | undefined;
  try {
    official = await getChannelBySlug(key);
    if (!official) throw new ChannelNotFoundError(key);
  } catch (err) {
    if (err instanceof ChannelNotFoundError) throw err;
    // not authorized or official API failed — fall through to public lookup
  }

  const v2 = await fetchChannelV2(key);
  if (!v2 && !official) throw new ChannelNotFoundError(key);
  if (!v2 && official) throw new Error(`Kick has ${key}, but CamelBot could not read its chatroom`);

  const userId = v2?.user_id ?? official?.broadcaster_user_id;
  const chatroomId = v2?.chatroom?.id;
  if (!userId || !chatroomId) {
    if (official) throw new Error(`Kick has ${key}, but CamelBot could not read its chatroom`);
    throw new ChannelNotFoundError(key);
  }

  const data: PublicChannel = {
    slug: key,
    userId,
    chatroomId,
    title:
      official?.stream_title ||
      v2?.livestream?.session_title?.trim() ||
      v2?.previous_livestream?.session_title?.trim() ||
      "",
    game:
      official?.category?.name ||
      v2?.livestream?.categories?.[0]?.name ||
      v2?.previous_livestream?.categories?.[0]?.name ||
      v2?.recent_categories?.[0]?.name ||
      "",
    live: official?.stream?.is_live ?? Boolean(v2?.livestream),
    startedAt: parseStart(
      official?.stream?.start_time,
      v2?.livestream?.created_at,
      v2?.livestream?.start_time,
      v2?.livestream?.started_at,
    ),
  };
  cache.set(key, { at: Date.now(), data });
  return data;
}

async function fetchChannelV2(slug: string): Promise<KickV2 | null> {
  const url = `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`;
  const parsed = await readV2(await nodeFetch(url, slug));
  if (parsed.status === 404) return null;
  if (parsed.json) return parsed.json;
  if (parsed.status === 403 || parsed.status === 0) {
    const viaCurl = await readV2(await curlFetch(url, slug));
    if (viaCurl.status === 404) return null;
    if (viaCurl.json) return viaCurl.json;
  }
  return null;
}

async function nodeFetch(url: string, slug: string): Promise<{ status: number; body: string }> {
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        Origin: "https://kick.com",
        Referer: `https://kick.com/${slug}`,
        "User-Agent": UA,
      },
    });
    return { status: res.status, body: await res.text() };
  } catch {
    return { status: 0, body: "" };
  }
}

async function curlFetch(url: string, slug: string): Promise<{ status: number; body: string }> {
  try {
    const { stdout } = await execFileAsync(
      "curl",
      [
        "-sS",
        "-L",
        "-A",
        UA,
        "-H",
        "Accept: application/json",
        "-H",
        "Origin: https://kick.com",
        "-H",
        `Referer: https://kick.com/${slug}`,
        "-w",
        "\n__STATUS__%{http_code}",
        url,
      ],
      { timeout: 15_000, maxBuffer: 2_000_000 },
    );
    const idx = stdout.lastIndexOf("\n__STATUS__");
    if (idx < 0) return { status: 0, body: stdout };
    const body = stdout.slice(0, idx);
    const status = Number(stdout.slice(idx + "\n__STATUS__".length));
    return { status: Number.isFinite(status) ? status : 0, body };
  } catch {
    return { status: 0, body: "" };
  }
}

function readV2(res: { status: number; body: string }): { status: number; json: KickV2 | null } {
  if (res.status === 404) return { status: 404, json: null };
  if (res.status !== 200) return { status: res.status, json: null };
  try {
    const json = JSON.parse(res.body) as KickV2;
    if (json.message?.toLowerCase().includes("not found")) return { status: 404, json: null };
    return { status: 200, json };
  } catch {
    return { status: res.status, json: null };
  }
}

function parseStart(...values: Array<string | undefined>): number | undefined {
  for (const value of values) {
    if (!value) continue;
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return ms;
  }
  return undefined;
}

const cardCache = new Map<string, { at: number; nick?: string; bio?: string }>();

export async function lookupKickCard(slug: string): Promise<{ nick?: string; bio?: string }> {
  const key = slug.toLowerCase().trim();
  if (!key) return {};
  const hit = cardCache.get(key);
  if (hit && Date.now() - hit.at < 30 * 60_000) return { nick: hit.nick, bio: hit.bio };
  const v2 = await fetchChannelV2(key);
  const nick = v2?.user?.username?.trim();
  const bio = v2?.user?.bio?.replace(/\s+/g, " ").trim();
  const data = { at: Date.now(), nick, bio: bio?.slice(0, 180) };
  cardCache.set(key, data);
  return { nick: data.nick, bio: data.bio };
}

export function formatStreamContext(params: { slug: string; title?: string; game?: string; live?: boolean }): string {
  const bits = [`Channel: ${params.slug}`];
  if (params.title) bits.push(`Title: ${params.title}`);
  if (params.game) bits.push(`Game: ${params.game}`);
  if (params.live) bits.push("Currently live.");
  return bits.join(". ") + ".";
}
