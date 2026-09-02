import { config } from "../config.js";
import { refreshAccessToken } from "../auth/oauth.js";
import { loadBotTokens, loadTokens, saveBotTokens, saveTokens } from "../auth/tokenStore.js";
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

/** Slash commands as a user with mod/owner rights (bot account if logged in, else streamer). */
export async function sendChatCommand(content: string): Promise<boolean> {
  const channel = await getMyChannel();
  const payload = {
    content,
    type: "user",
    broadcaster_user_id: channel.broadcaster_user_id,
  };
  const bot = await getValidBotTokens();
  if (bot) {
    const res = await fetch(`${config.kick.apiBase}/chat`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bot.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (res.ok) return true;
    console.warn("[chat-cmd] bot", content, res.status, (await res.text()).slice(0, 180));
  }
  const res = await authorizedFetch("/chat", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    console.warn("[chat-cmd]", content, res.status, (await res.text()).slice(0, 180));
    return false;
  }
  return true;
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
  const targetId = targetBroadcasterUserId ?? homeId;
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
    const res = await authorizedFetch(`/chat/${encodeURIComponent(messageId)}`, { method: "DELETE" });
    if (res.status === 204 || res.ok) return;
    console.warn("[mod] delete failed", res.status, (await res.text()).slice(0, 180));
  } catch (err) {
    console.warn("[mod] delete failed", err);
  }
}

/** Timeout in minutes, or omit duration / pass null for a permanent ban. */
export async function removeBan(broadcasterUserId: number, userId: number): Promise<void> {
  try {
    const res = await authorizedFetch("/moderation/bans", {
      method: "DELETE",
      body: JSON.stringify({ broadcaster_user_id: broadcasterUserId, user_id: userId }),
    });
    if (res.ok) return;
    console.warn("[mod] unban failed", res.status, (await res.text()).slice(0, 180));
  } catch (err) {
    console.warn("[mod] unban failed", err);
  }
}

/** Kick timeouts are minutes (min 1). Ban then unban after `ms` to fake a short mute. */
export async function shortTimeout(
  broadcasterUserId: number,
  userId: number,
  ms: number,
  reason: string,
): Promise<void> {
  await timeoutOrBan(broadcasterUserId, userId, 1, reason);
  await new Promise((resolve) => setTimeout(resolve, Math.max(1500, ms)));
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
    const res = await authorizedFetch("/moderation/bans", {
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
