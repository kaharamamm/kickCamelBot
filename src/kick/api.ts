import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../config.js";
import { refreshAccessToken } from "../auth/oauth.js";
import { loadBotTokens, loadTokens, saveBotTokens, saveTokens } from "../auth/tokenStore.js";
import {
  hasSiteSession,
  loadSiteSession,
  parseSessionToken,
  parseXsrfToken,
} from "../auth/siteSession.js";
import { lookupPublicChannel } from "./publicChannel.js";
import type {
  ChannelReward,
  KickChannel,
  KickUser,
  KicksLeaderboard,
  TokenSet,
} from "../types.js";

type KickEnvelope<T> = {
  data?: T;
  message?: string;
};

class KickApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
  }
}

async function authorizedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const tokens = await getValidTokens();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${tokens.accessToken}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${config.kick.apiBase}${path}`, { ...init, headers });
}

/** Prefer the linked bot account for mod actions (ban/timeout/delete) so the streamer isn't the actor. */
async function moderationFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const bot = await getValidBotTokens();
  const tokens = bot ?? (await getValidTokens());
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${tokens.accessToken}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (!bot) {
    console.warn("[mod] bot account not linked — falling back to streamer token");
  }
  return fetch(`${config.kick.apiBase}${path}`, { ...init, headers });
}

export async function getValidTokens(): Promise<TokenSet> {
  const tokens = loadTokens();
  if (!tokens) {
    throw new Error("Not authorized. Open http://localhost:3000/login");
  }
  if (Date.now() < tokens.expiresAt - 60_000) {
    return tokens;
  }
  if (!tokens.refreshToken) {
    throw new Error("Access token expired and no refresh token is stored. Open /login again.");
  }
  const next = await refreshAccessToken(tokens.refreshToken);
  next.user = tokens.user;
  saveTokens(next);
  return next;
}

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) {
    throw new KickApiError(`Kick API ${res.status}`, res.status, text);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export async function getMe(): Promise<KickUser> {
  const res = await authorizedFetch("/users");
  const json = await readJson<KickEnvelope<KickUser[]>>(res);
  const me = json.data?.[0];
  if (!me) throw new Error("Kick returned no user for this token");
  return me;
}

export async function getMyChannel(): Promise<KickChannel> {
  const res = await authorizedFetch("/channels");
  const json = await readJson<KickEnvelope<KickChannel[]>>(res);
  const channel = json.data?.[0];
  if (!channel) throw new Error("Kick returned no channel for this token");
  homeCache = { at: Date.now(), channel };
  return channel;
}

let homeCache: { at: number; channel: KickChannel } | undefined;

export async function getMyChannelCached(ttlMs = 20_000): Promise<KickChannel> {
  if (homeCache && Date.now() - homeCache.at < ttlMs) return homeCache.channel;
  return getMyChannel();
}

export async function getChannelBySlug(slug: string): Promise<KickChannel | null> {
  const res = await authorizedFetch(`/channels?slug=${encodeURIComponent(slug)}`);
  const json = await readJson<KickEnvelope<KickChannel[]>>(res);
  return json.data?.[0] ?? null;
}

export async function updateStreamTitle(streamTitle: string): Promise<void> {
  await patchChannel({ stream_title: streamTitle });
}

export async function updateStreamCategory(categoryId: number): Promise<void> {
  await patchChannel({ category_id: categoryId });
}

async function patchChannel(body: { stream_title?: string; category_id?: number }): Promise<void> {
  const res = await authorizedFetch("/channels", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  if (res.status !== 204 && !res.ok) {
    throw new KickApiError(`Failed to update channel (${res.status})`, res.status, await res.text());
  }
  homeCache = undefined;
}

function parseCategories(data: Array<{ id?: number; name?: string }> | undefined): Array<{ id: number; name: string }> {
  return (data ?? [])
    .filter((row): row is { id: number; name: string } => Boolean(row.id && row.name))
    .slice(0, 12);
}

export async function searchCategories(query: string): Promise<Array<{ id: number; name: string }>> {
  const q = query.trim();
  if (!q) return [];
  const v1 = await authorizedFetch(`/categories?q=${encodeURIComponent(q)}`);
  const v1json = await readJson<KickEnvelope<Array<{ id?: number; name?: string }>>>(v1);
  const fromV1 = parseCategories(v1json.data);
  if (fromV1.length) return fromV1;

  const tokens = await getValidTokens();
  const v2Base = config.kick.apiBase.replace(/\/public\/v1\/?$/, "/public/v2");
  const v2 = await fetch(`${v2Base}/categories?name=${encodeURIComponent(q)}&limit=25`, {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
  });
  const v2json = await readJson<KickEnvelope<Array<{ id?: number; name?: string }>>>(v2);
  return parseCategories(v2json.data);
}

export type ModSlashResult = { ok: true } | { ok: false; reason: string };

const execFileAsync = promisify(execFile);

const SITE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function kickCurlRequest(
  url: string,
  slug: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<{ status: number; body: string }> {
  const method = init.method ?? "GET";
  const args = ["-sS", "-L", "-A", SITE_UA, "-X", method];
  const headers = {
    Accept: "application/json",
    Origin: "https://kick.com",
    Referer: `https://kick.com/${slug}`,
    ...init.headers,
  };
  for (const [key, value] of Object.entries(headers)) {
    args.push("-H", `${key}: ${value}`);
  }
  if (init.body) args.push("-d", init.body);
  args.push("-w", "\n__STATUS__%{http_code}", url);
  try {
    const { stdout } = await execFileAsync("curl", args, { timeout: 20_000, maxBuffer: 2_000_000 });
    const idx = stdout.lastIndexOf("\n__STATUS__");
    if (idx < 0) return { status: 0, body: stdout };
    const body = stdout.slice(0, idx);
    const status = Number(stdout.slice(idx + "\n__STATUS__".length));
    return { status: Number.isFinite(status) ? status : 0, body };
  } catch {
    return { status: 0, body: "" };
  }
}

async function kickSiteSessionPost(
  url: string,
  slug: string,
  cookie: string,
  xsrf: string,
  payload: object,
): Promise<{ status: number; body: string }> {
  const body = JSON.stringify(payload);
  const xsrfRaw = cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/i)?.[1] ?? xsrf;

  for (const token of [xsrf, xsrfRaw]) {
    const headers = {
      Cookie: cookie,
      "X-XSRF-TOKEN": token,
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Requested-With": "XMLHttpRequest",
    };
    const viaCurl = await kickCurlRequest(url, slug, { method: "POST", headers, body });
    if (viaCurl.status >= 200 && viaCurl.status < 300) return viaCurl;
    if (viaCurl.status === 401 || viaCurl.status === 403) continue;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { ...headers, Origin: "https://kick.com", Referer: `https://kick.com/${slug}`, "User-Agent": SITE_UA },
        body,
      });
      const raw = await res.text();
      if (res.ok) return { status: res.status, body: raw };
      if (res.status !== 401 && res.status !== 403) return { status: res.status, body: raw };
    } catch {
      /* try next xsrf form */
    }
  }

  return kickCurlRequest(url, slug, {
    method: "POST",
    headers: {
      Cookie: cookie,
      "X-XSRF-TOKEN": xsrf,
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Requested-With": "XMLHttpRequest",
    },
    body,
  });
}

type ChatroomModePatch = {
  slow_mode?: boolean;
  message_interval?: number;
  emotes_mode?: boolean;
  followers_mode?: boolean;
  following_min_duration?: number;
  subscribers_mode?: boolean;
};

/**
 * Kick public OAuth cannot run /clear or chat modes (only title/ban/etc).
 * Site session_token (streamer browser login) can — use that as the real actor.
 */
export async function sendChatCommand(content: string): Promise<ModSlashResult> {
  const cmd = content.trim();
  if (!cmd.startsWith("/")) return { ok: false, reason: "not_a_slash_command" };

  const channel = await getMyChannel();
  const slug = channel.slug.toLowerCase();
  const parts = cmd.replace(/^\//, "").split(/\s+/);
  const name = (parts[0] ?? "").toLowerCase();
  const parameter = parts.length > 1 ? parts.slice(1).join(" ") : null;

  const modePatch = chatModePatchFromSlash(name, parameter);
  if (modePatch) return patchChatroomModes(slug, modePatch);

  const payload = { command: name, parameter };
  const siteToken = siteSessionBearer();
  if (siteToken) {
    const viaSite = await kickChatCommandWithBearer(slug, siteToken, payload);
    if (viaSite.ok) return viaSite;
    console.warn("[chat-cmd] site session_token", cmd, viaSite.reason);
  }

  // Cookie + XSRF fallback (often 401 if kick_session expired; session_token path above is preferred).
  if (!hasSiteSession()) {
    return { ok: false, reason: "site_session_required" };
  }

  const session = loadSiteSession();
  const xsrf = session ? parseXsrfToken(session.cookie) : undefined;
  if (!session?.cookie || !xsrf) {
    return { ok: false, reason: "site_session_invalid" };
  }

  const cmdUrl = `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}/chat-commands`;
  const { status, body: raw } = await kickSiteSessionPost(cmdUrl, slug, session.cookie, xsrf, payload);

  if (status >= 200 && status < 300) {
    try {
      const json = JSON.parse(raw) as { success?: boolean; message?: string };
      if (json.success === true) return { ok: true };
      if (json.success === false) {
        return { ok: false, reason: json.message?.trim() || "chat_command_rejected" };
      }
    } catch {
      /* non-json 2xx — treat as ok */
    }
    return { ok: true };
  }

  const lastReason = status ? `site_api_${status}` : "site_api_network_error";
  if (status !== 404 && status !== 422) {
    console.warn("[chat-cmd] site cookies", cmd, status, raw.slice(0, 180));
  }
  return { ok: false, reason: lastReason };
}

function siteSessionBearer(): string | null {
  const session = loadSiteSession();
  if (!session?.cookie) return null;
  return parseSessionToken(session.cookie) ?? null;
}

function siteAuthHeaders(slug: string, token: string): Record<string, string> {
  const session = loadSiteSession();
  const cookie = session?.cookie ?? "";
  const xsrf = cookie ? parseXsrfToken(cookie) : undefined;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    Origin: "https://kick.com",
    Referer: `https://kick.com/${slug}`,
    "User-Agent": SITE_UA,
  };
  if (cookie) headers.Cookie = cookie;
  if (xsrf) {
    headers["X-XSRF-TOKEN"] = xsrf;
    headers["X-Requested-With"] = "XMLHttpRequest";
  }
  return headers;
}

function chatModePatchFromSlash(name: string, parameter: string | null): ChatroomModePatch | null {
  const args = (parameter ?? "").trim().toLowerCase();
  const on = !args || args === "on" || args.startsWith("on ");

  if (name === "slow" || name === "slowmode") {
    if (!on || args === "off") return { slow_mode: false };
    const gapMatch = args.match(/(?:^on\s+)?(\d+)/);
    const gap = Math.min(120, Math.max(1, Number(gapMatch?.[1] ?? 10)));
    return { slow_mode: true, message_interval: gap };
  }
  if (name === "emoteonly" || name === "emotesonly") {
    return { emotes_mode: on && args !== "off" };
  }
  if (name === "followonly" || name === "followers") {
    if (!on || args === "off") return { followers_mode: false, following_min_duration: 0 };
    const mins = Math.max(0, Number(args.match(/(\d+)/)?.[1] ?? 0));
    return { followers_mode: true, following_min_duration: Math.max(1, mins || 1) };
  }
  if (name === "subonly" || name === "subscribers") {
    return { subscribers_mode: on && args !== "off" };
  }
  return null;
}

async function patchChatroomModes(slug: string, patch: ChatroomModePatch): Promise<ModSlashResult> {
  const token = siteSessionBearer();
  if (!token) return { ok: false, reason: "site_session_required" };

  const url = `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}/chatroom`;
  const headers = siteAuthHeaders(slug, token);
  const body = JSON.stringify(patch);

  // Prefer curl (better Cloudflare TLS fingerprint) then fetch.
  const viaCurl = await kickCurlRequest(url, slug, { method: "PUT", headers, body });
  if (viaCurl.status >= 200 && viaCurl.status < 300) {
    return parseChatroomPutResult(viaCurl.body, patch);
  }

  try {
    const res = await fetch(url, { method: "PUT", headers, body });
    const raw = await res.text();
    if (!res.ok) {
      console.warn("[chatroom] put", res.status, raw.slice(0, 180));
      return { ok: false, reason: viaCurl.status ? `chatroom_api_${viaCurl.status}` : `chatroom_api_${res.status}` };
    }
    return parseChatroomPutResult(raw, patch);
  } catch (err) {
    console.warn("[chatroom] network", err);
    return { ok: false, reason: viaCurl.status ? `chatroom_api_${viaCurl.status}` : "chatroom_network_error" };
  }
}

function parseChatroomPutResult(raw: string, patch: ChatroomModePatch): ModSlashResult {
  try {
    const json = JSON.parse(raw) as {
      slow_mode?: { enabled?: boolean };
      emotes_mode?: { enabled?: boolean };
      followers_mode?: { enabled?: boolean };
      subscribers_mode?: { enabled?: boolean };
    };
    if (patch.slow_mode !== undefined && Boolean(json.slow_mode?.enabled) !== patch.slow_mode) {
      return { ok: false, reason: "chatroom_slow_not_applied" };
    }
    if (patch.emotes_mode !== undefined && Boolean(json.emotes_mode?.enabled) !== patch.emotes_mode) {
      return { ok: false, reason: "chatroom_emote_not_applied" };
    }
    if (patch.followers_mode !== undefined && Boolean(json.followers_mode?.enabled) !== patch.followers_mode) {
      return { ok: false, reason: "chatroom_follow_not_applied" };
    }
    if (
      patch.subscribers_mode !== undefined &&
      Boolean(json.subscribers_mode?.enabled) !== patch.subscribers_mode
    ) {
      return { ok: false, reason: "chatroom_sub_not_applied" };
    }
  } catch {
    /* non-json ok */
  }
  return { ok: true };
}

async function kickChatCommandWithBearer(
  slug: string,
  accessToken: string,
  payload: { command: string; parameter: string | null },
): Promise<ModSlashResult> {
  const urls = [
    `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}/chat-commands`,
    `https://kick.com/api/v1/channels/${encodeURIComponent(slug)}/chat-commands`,
  ];
  let lastReason = "oauth_chat_command_failed";
  const headers = siteAuthHeaders(slug, accessToken);
  const body = JSON.stringify(payload);

  for (const url of urls) {
    const viaCurl = await kickCurlRequest(url, slug, { method: "POST", headers, body });
    if (viaCurl.status >= 200 && viaCurl.status < 300) {
      try {
        const json = JSON.parse(viaCurl.body) as { success?: boolean; message?: string };
        if (json.success === false) {
          lastReason = json.message?.trim() || "chat_command_rejected";
          continue;
        }
      } catch {
        /* ok */
      }
      return { ok: true };
    }
    if (viaCurl.status) lastReason = `oauth_api_${viaCurl.status}`;

    try {
      const res = await fetch(url, { method: "POST", headers, body });
      const raw = await res.text();
      if (res.ok) {
        try {
          const json = JSON.parse(raw) as { success?: boolean; message?: string };
          if (json.success === false) {
            lastReason = json.message?.trim() || "chat_command_rejected";
            continue;
          }
        } catch {
          /* ok */
        }
        return { ok: true };
      }
      lastReason = `oauth_api_${res.status}`;
      if (res.status !== 401 && res.status !== 403 && res.status !== 404) {
        console.warn("[chat-cmd] bearer", url, res.status, raw.slice(0, 160));
      }
    } catch (err) {
      lastReason = "oauth_network_error";
      console.warn("[chat-cmd] bearer network", err);
    }
  }
  return { ok: false, reason: lastReason };
}

export async function getValidBotTokens(): Promise<TokenSet | null> {
  const tokens = loadBotTokens();
  if (!tokens) return null;
  if (Date.now() < tokens.expiresAt - 60_000) return tokens;
  if (!tokens.refreshToken) return tokens;
  const next = await refreshAccessToken(tokens.refreshToken);
  next.user = tokens.user;
  saveBotTokens(next);
  return next;
}

export async function sendChat(
  content: string,
  replyToMessageId?: string,
  targetBroadcasterUserId?: number,
): Promise<string | undefined> {
  const clipped = clipChat(content);
  const channel = await getMyChannel();
  const streamer = await getValidTokens();
  const bot = await getValidBotTokens();
  const homeId = channel.broadcaster_user_id ?? streamer.user?.user_id;
  const targetId =
    targetBroadcasterUserId && targetBroadcasterUserId > 0 ? targetBroadcasterUserId : homeId;
  const crossChannel = Boolean(targetId && homeId && targetId !== homeId);

  const payload: Record<string, unknown> = {
    content: clipped,
    type: crossChannel || bot ? "user" : "bot",
  };
  if (replyToMessageId) payload.reply_to_message_id = replyToMessageId;
  if (payload.type === "user") payload.broadcaster_user_id = targetId;

  if (bot) {
    const res = await fetch(`${config.kick.apiBase}/chat`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bot.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const json = await readJson<KickEnvelope<{ is_sent?: boolean; message_id?: string }>>(res);
    return json.data?.message_id;
  }

  let res = await authorizedFetch("/chat", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (res.status >= 400 && payload.type === "bot") {
    const errBody = await res.text();
    console.warn(
      `[chat] type=bot failed (${res.status}). Posting as your streamer account until /login-bot. ${errBody.slice(0, 200)}`,
    );
    payload.type = "user";
    payload.broadcaster_user_id = targetId;
    res = await authorizedFetch("/chat", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  const json = await readJson<KickEnvelope<{ is_sent?: boolean; message_id?: string }>>(res);
  return json.data?.message_id;
}

export async function getLeaderboard(top = 5): Promise<KicksLeaderboard> {
  const res = await authorizedFetch(`/kicks/leaderboard?top=${top}`);
  const json = await readJson<KickEnvelope<KicksLeaderboard>>(res);
  return json.data ?? { lifetime: [], month: [], week: [] };
}

export async function getRewards(): Promise<ChannelReward[]> {
  const res = await authorizedFetch("/channels/rewards");
  const json = await readJson<KickEnvelope<ChannelReward[]>>(res);
  return json.data ?? [];
}

export async function createReward(title: string, cost: number, description?: string): Promise<ChannelReward> {
  const res = await authorizedFetch("/channels/rewards", {
    method: "POST",
    body: JSON.stringify({
      title,
      cost,
      description: description ?? "",
      is_enabled: true,
    }),
  });
  const json = await readJson<KickEnvelope<ChannelReward>>(res);
  if (!json.data) throw new Error("Kick did not return the new reward");
  return json.data;
}

export async function subscribeToEvents(): Promise<void> {
  const events = [
    { name: "chat.message.sent", version: 1 },
    { name: "channel.followed", version: 1 },
    { name: "channel.subscription.new", version: 1 },
    { name: "channel.reward.redemption.updated", version: 1 },
    { name: "kicks.gifted", version: 1 },
    { name: "livestream.metadata.updated", version: 1 },
    { name: "channel.subscription.gifts", version: 1 },
    { name: "channel.subscription.renewal", version: 1 },
  ];

  const existing = await authorizedFetch("/events/subscriptions");
  const current = await readJson<KickEnvelope<Array<{ id: string; event: string }>>>(existing);
  const ids = (current.data ?? []).map((row) => row.id);
  if (ids.length > 0) {
    const qs = ids.map((id) => `id=${encodeURIComponent(id)}`).join("&");
    await authorizedFetch(`/events/subscriptions?${qs}`, { method: "DELETE" });
  }

  const res = await authorizedFetch("/events/subscriptions", {
    method: "POST",
    body: JSON.stringify({ events, method: "webhook" }),
  });
  const json = await readJson<KickEnvelope<Array<{ name: string; error?: string }>>>(res);
  for (const row of json.data ?? []) {
    if (row.error) {
      console.warn(`[events] ${row.name}: ${row.error}`);
    } else {
      console.log(`[events] subscribed ${row.name}`);
    }
  }
}

export async function deleteChatMessage(messageId: string): Promise<void> {
  if (!messageId) return;
  try {
    const res = await moderationFetch(`/chat/${encodeURIComponent(messageId)}`, { method: "DELETE" });
    if (res.status === 204 || res.ok) return;
    console.warn("[mod] delete failed", res.status, (await res.text()).slice(0, 180));
  } catch (err) {
    console.warn("[mod] delete failed", err);
  }
}

async function kickSiteToken(): Promise<string | null> {
  const tokens = await kickSiteTokens();
  return tokens[0] ?? null;
}

async function kickSiteTokens(): Promise<string[]> {
  const out: string[] = [];
  try {
    out.push((await getValidTokens()).accessToken);
  } catch {
    /* streamer not logged in */
  }
  const bot = await getValidBotTokens();
  if (bot?.accessToken) out.push(bot.accessToken);
  return out;
}

/** Pin a chat message (uses Kick site API — needs mod/broadcaster token). */
export async function pinChatMessage(messageId: string, channelSlug?: string): Promise<boolean> {
  if (!messageId) return false;
  const channel = await getMyChannel();
  const slug = (channelSlug || channel.slug).toLowerCase();
  const token = await kickSiteToken();
  if (!token) return false;

  const urls = [
    `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}/pinned-message`,
    `https://kick.com/api/internal/v1/channels/${encodeURIComponent(slug)}/chatroom/pinned-message`,
  ];
  const bodies: Record<string, unknown>[] = [
    { message_id: messageId },
    { chat_message_id: messageId },
    { id: messageId },
  ];

  for (const url of urls) {
    for (const body of bodies) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(body),
        });
        if (res.ok) return true;
        if (res.status !== 404 && res.status !== 422) {
          console.warn("[pin]", url, res.status, (await res.text()).slice(0, 160));
        }
      } catch (err) {
        console.warn("[pin] request failed", url, err);
      }
    }
  }
  return sendChatCommand(`/pin ${messageId}`).then((r) => r.ok);
}

export async function unpinChatMessage(channelSlug?: string): Promise<boolean> {
  const channel = await getMyChannel();
  const slug = (channelSlug || channel.slug).toLowerCase();
  const token = await kickSiteToken();
  if (!token) return false;

  const urls = [
    `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}/pinned-message`,
    `https://kick.com/api/internal/v1/channels/${encodeURIComponent(slug)}/chatroom/pinned-message`,
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      if (res.ok || res.status === 204) return true;
    } catch (err) {
      console.warn("[unpin] failed", url, err);
    }
  }
  return sendChatCommand("/unpin").then((r) => r.ok);
}

/** Timeout in minutes, or omit duration / pass null for a permanent ban. */
export async function removeBan(broadcasterUserId: number, userId: number): Promise<void> {
  try {
    const res = await moderationFetch("/moderation/bans", {
      method: "DELETE",
      body: JSON.stringify({ broadcaster_user_id: broadcasterUserId, user_id: userId }),
    });
    if (res.ok) return;
    console.warn("[mod] unban failed", res.status, (await res.text()).slice(0, 180));
  } catch (err) {
    console.warn("[mod] unban failed", err);
  }
}

/**
 * Kick timeouts are minutes (min 1). For short fun mutes we ban 1 min then unban after `ms`.
 * Always wait the full `ms` before unban so it isn't instant.
 */
export async function shortTimeout(
  broadcasterUserId: number,
  userId: number,
  ms: number,
  reason: string,
): Promise<void> {
  const holdMs = Math.max(5_000, Math.floor(ms));
  await timeoutOrBan(broadcasterUserId, userId, 1, reason);
  await new Promise<void>((resolve) => {
    setTimeout(resolve, holdMs);
  });
  await removeBan(broadcasterUserId, userId);
}

export async function timeoutOrBan(
  broadcasterUserId: number,
  userId: number,
  durationMinutes: number | null,
  reason: string,
): Promise<void> {
  const body: Record<string, unknown> = {
    broadcaster_user_id: broadcasterUserId,
    user_id: userId,
    reason: reason.slice(0, 100),
  };
  if (durationMinutes && durationMinutes >= 1) body.duration = Math.min(10080, Math.floor(durationMinutes));
  try {
    const res = await moderationFetch("/moderation/bans", {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (res.ok) return;
    console.warn("[mod] ban failed", res.status, (await res.text()).slice(0, 180));
  } catch (err) {
    console.warn("[mod] ban failed", err);
  }
}

export function clipChat(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if ([...trimmed].length <= 480) return trimmed;
  return `${[...trimmed].slice(0, 477).join("")}...`;
}

export { KickApiError };
