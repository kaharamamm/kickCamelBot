import { extraChannels, extraChannelSlugs, rememberChannelMeta } from "../bot/channelStore.js";
import { startEngagement, stopEngagement } from "../bot/engagement.js";
import { startTimedCommands, stopTimedCommands } from "../bot/timed.js";
import { handleChatMessage, handleGiftSubs, handleNewSub, handleRaid } from "../bot/router.js";
import { config } from "../config.js";
import { getMyChannel } from "./api.js";
import { lookupPublicChannel } from "./publicChannel.js";
import type { ChatMessageEvent, KickActor } from "../types.js";

const PUSHER_URL =
  "wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.4.0&flash=false";

export let liveChatStatus = "disconnected";
export let liveChatChannels: string[] = [];

type Room = {
  slug: string;
  chatroomId: number;
  channelId: number;
  broadcaster: KickActor;
};

type PusherChat = {
  id?: string | number;
  content?: string;
  chatroom_id?: number;
  created_at?: string;
  type?: string;
  sender?: {
    id?: number;
    username?: string;
    slug?: string;
    verified?: boolean;
    is_verified?: boolean;
    identity?: { color?: string; badges?: Array<{ type?: string; text?: string; count?: number }> };
  };
  metadata?:
    | string
    | {
        original_sender?: { id?: number; username?: string; slug?: string };
        original_message?: { id?: string | number; content?: string };
        message_ref?: {
          message_id?: string;
          content?: string;
          sender?: { id?: number; username?: string };
        };
      };
  replies_to?: {
    message_id?: string;
    content?: string;
    sender?: { user_id?: number; id?: number; username?: string; channel_slug?: string };
  };
  emotes?: unknown;
};

const KNOWN: Record<string, { userId: number; chatroomId: number }> = {
  mcvckaharamamm: { userId: 549839, chatroomId: 533451 },
  kaiserdoto: { userId: 54093635, chatroomId: 52681503 },
};

let active: WebSocket | undefined;
let generation = 0;

export async function startLiveChat(): Promise<void> {
  stopLiveChat();
  const home = await getMyChannel();
  const slugs = unique([home.slug, ...extraChannelSlugs()]);
  const rooms: Room[] = [];

  for (const slug of slugs) {
    try {
      const room = await resolveRoom(slug, home);
      rooms.push(room);
      console.log(`[live-chat] ${slug} chatroom=${room.chatroomId} user=${room.broadcaster.user_id}`);
    } catch (err) {
      console.warn(`[live-chat] skip ${slug}`, err);
    }
  }

  if (rooms.length === 0) throw new Error("No Kick chatrooms to join");
  liveChatChannels = rooms.map((r) => r.slug);
  connect(rooms);
  startEngagement(
    rooms.map((r) => ({ slug: r.slug, broadcasterUserId: r.broadcaster.user_id })),
  );
  const homeRoom = rooms.find((r) => r.slug === home.slug) ?? rooms[0];
  if (homeRoom) {
    startTimedCommands({ slug: homeRoom.slug, broadcasterUserId: homeRoom.broadcaster.user_id });
  }
}

export function liveChatListening(): boolean {
  return Boolean(active && active.readyState === WebSocket.OPEN);
}

export function stopLiveChat(): void {
  generation += 1;
  stopEngagement();
  stopTimedCommands();
  try {
    active?.close();
  } catch {
    // ignore
  }
  active = undefined;
}

function connect(rooms: Room[]): void {
  const byChatroom = new Map(rooms.map((r) => [r.chatroomId, r]));
  const gen = generation;
  const ws = new WebSocket(PUSHER_URL);
  active = ws;
  let ping: ReturnType<typeof setInterval> | undefined;
  let joined = 0;

  ws.addEventListener("open", () => {
    liveChatStatus = "connected";
    console.log("[live-chat] socket open");
  });

  ws.addEventListener("message", (event) => {
    const frame = JSON.parse(String(event.data)) as { event?: string; data?: string; channel?: string };
    if (frame.event === "pusher:connection_established") {
      for (const room of rooms) {
        ws.send(
          JSON.stringify({
            event: "pusher:subscribe",
            data: { auth: "", channel: `chatrooms.${room.chatroomId}.v2` },
          }),
        );
        if (room.channelId) {
          ws.send(
            JSON.stringify({
              event: "pusher:subscribe",
              data: { auth: "", channel: `channel.${room.channelId}` },
            }),
          );
        }
      }
      ping = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ event: "pusher:ping", data: {} }));
        }
      }, 90_000);
      return;
    }
    if (frame.event === "pusher_internal:subscription_succeeded") {
      joined += 1;
      liveChatStatus = `listening (${joined} subs)`;
      console.log(`[live-chat] subscribed ${frame.channel ?? ""}`);
      return;
    }
    if (frame.event && frame.event !== "App\\Events\\ChatMessageEvent") {
      handlePusherEvent(frame.event, parsePayload(frame.data), byChatroom, rooms);
      return;
    }
    if (frame.event !== "App\\Events\\ChatMessageEvent") return;
    if (frame.channel && !String(frame.channel).startsWith("chatrooms.")) return;
    const payload = asChat(parsePayload(frame.data));
    if (!payload?.content || !payload.sender) return;
    const room =
      (payload.chatroom_id ? byChatroom.get(payload.chatroom_id) : undefined) ??
      rooms[0];
    if (!room) return;
    const incoming: ChatMessageEvent = {
      message_id: String(payload.id ?? `${Date.now()}`),
      content: payload.content,
      created_at: payload.created_at,
      emotes: Array.isArray(payload.emotes) ? payload.emotes : undefined,
      replies_to: extractReply(payload),
      broadcaster: room.broadcaster,
      sender: {
        user_id: payload.sender.id ?? 0,
        username: payload.sender.username ?? payload.sender.slug ?? "viewer",
        channel_slug: payload.sender.slug,
        is_verified: Boolean(
          payload.sender.verified ||
            payload.sender.is_verified ||
            (payload.sender.identity?.badges ?? []).some((b) => (b.type ?? "").toLowerCase() === "verified"),
        ),
        identity: {
          username_color: payload.sender.identity?.color,
          badges: (payload.sender.identity?.badges ?? []).map((b) => ({
            type: b.type ?? "",
            text: b.text ?? "",
            count: b.count,
          })),
        },
      },
    };
    void handleChatMessage(incoming).catch((err) => {
      console.warn("[live-chat] handler failed", err);
    });
  });

  ws.addEventListener("close", (event) => {
    if (ping) clearInterval(ping);
    if (gen !== generation) return;
    liveChatStatus = `closed ${event.code}`;
    console.warn(`[live-chat] closed (${event.code}). Reconnecting in 3s`);
    setTimeout(() => {
      if (gen === generation) connect(rooms);
    }, 3000);
  });

  ws.addEventListener("error", () => {
    liveChatStatus = "error";
  });
}

function parsePayload(data: string | undefined): Record<string, unknown> | null {
  if (!data) return null;
  try {
    const parsed = JSON.parse(data) as unknown;
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

function asChat(payload: Record<string, unknown> | null): PusherChat | null {
  if (!payload) return null;
  return payload as PusherChat;
}

function extractReply(payload: PusherChat): ChatMessageEvent["replies_to"] {
  try {
    const rawMeta = payload.metadata;
    const meta =
      typeof rawMeta === "string"
        ? (JSON.parse(rawMeta) as Exclude<PusherChat["metadata"], string>)
        : rawMeta;
    const ref = meta?.message_ref;
    const name =
      meta?.original_sender?.username ||
      ref?.sender?.username ||
      payload.replies_to?.sender?.username ||
      "";
    const content =
      meta?.original_message?.content || ref?.content || payload.replies_to?.content || "";
    const id =
      payload.replies_to?.message_id || meta?.original_message?.id || ref?.message_id || "";
    if (!name && !content && !id && payload.type !== "reply") return null;
    if (!name && !content && !id) return null;
    return {
      message_id: String(id || ""),
      content,
      sender: {
        user_id:
          meta?.original_sender?.id ??
          ref?.sender?.id ??
          payload.replies_to?.sender?.user_id ??
          payload.replies_to?.sender?.id ??
          0,
        username: name || "viewer",
        channel_slug: meta?.original_sender?.slug || payload.replies_to?.sender?.channel_slug,
      },
    };
  } catch {
    return null;
  }
}

function handlePusherEvent(
  event: string,
  payload: Record<string, unknown> | null,
  byChatroom: Map<number, Room>,
  rooms: Room[],
): void {
  const raid = extractRaid(event, payload);
  if (raid) {
    const room = roomForPayload(payload, byChatroom, rooms);
    void handleRaid({
      username: raid.username,
      viewers: raid.viewers,
      broadcasterUserId: room?.broadcaster.user_id,
    });
    return;
  }
  if (!payload) return;
  const room = roomForPayload(payload, byChatroom, rooms);
  const broadcasterUserId = room?.broadcaster.user_id;
  const extra = payload as {
    username?: string;
    months?: number;
    gifter_username?: string;
    gifted?: number;
    gifted_usernames?: string[];
    giftees?: unknown[];
    gifter?: { username?: string };
    sender?: { username?: string };
    chatroom_id?: number;
  };

  if (event.includes("SubscriptionEvent") && !event.includes("Gifted")) {
    const username = extra.username || extra.sender?.username;
    if (username) void handleNewSub(username, extra.months, broadcasterUserId);
    return;
  }
  if (event.includes("GiftedSubscription")) {
    const count = extra.gifted || extra.gifted_usernames?.length || extra.giftees?.length || 1;
    void handleGiftSubs({
      gifter: extra.gifter_username || extra.gifter?.username,
      count,
      broadcasterUserId,
    });
  }
}

function roomForPayload(
  payload: Record<string, unknown> | null,
  byChatroom: Map<number, Room>,
  rooms: Room[],
): Room | undefined {
  const chatroomId = Number(
    payload?.chatroom_id ??
      (payload?.chatroom as { id?: number } | undefined)?.id ??
      0,
  );
  if (chatroomId) return byChatroom.get(chatroomId) ?? rooms[0];
  return rooms[0];
}

function extractRaid(
  event: string,
  payload: Record<string, unknown> | null,
): { username: string; viewers?: number } | null {
  const name = event.toLowerCase();
  if (!/streamhost|raid|chattomove|move.?to.?channel/.test(name)) return null;
  const username =
    pickString(
      payload,
      "host_username",
      "username",
      ["host", "username"],
      ["hosted", "username"],
      ["user", "username"],
      ["raider", "username"],
      ["from", "username"],
      ["channel", "username"],
      ["channel", "slug"],
    ) || "raiders";
  const viewers = pickNumber(payload, "number_viewers", "viewer_count", "viewers", "viewercount");
  return { username, viewers };
}

function pickString(
  payload: Record<string, unknown> | null,
  ...paths: Array<string | [string, string]>
): string | undefined {
  if (!payload) return undefined;
  for (const path of paths) {
    if (typeof path === "string") {
      const value = payload[path];
      if (typeof value === "string" && value.trim()) return value.trim();
      continue;
    }
    const obj = payload[path[0]];
    if (obj && typeof obj === "object") {
      const value = (obj as Record<string, unknown>)[path[1]];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return undefined;
}

function pickNumber(payload: Record<string, unknown> | null, ...keys: string[]): number | undefined {
  if (!payload) return undefined;
  for (const key of keys) {
    const n = Number(payload[key]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

async function resolveRoom(slug: string, home: { slug: string; broadcaster_user_id: number }): Promise<Room> {
  const saved = extraChannels().find((c) => c.slug === slug);
  if (saved?.userId && saved.chatroomId) {
    return {
      slug,
      chatroomId: saved.chatroomId,
      channelId: slug === home.slug ? home.broadcaster_user_id : saved.userId,
      broadcaster: {
        user_id: slug === home.slug ? home.broadcaster_user_id : saved.userId,
        username: slug,
        channel_slug: slug,
      },
    };
  }

  const known = KNOWN[slug];
  if (known) {
    return {
      slug,
      chatroomId: slug === home.slug && config.bot.chatroomId > 0 ? config.bot.chatroomId : known.chatroomId,
      channelId: slug === home.slug ? home.broadcaster_user_id : known.userId,
      broadcaster: {
        user_id: slug === home.slug ? home.broadcaster_user_id : known.userId,
        username: slug,
        channel_slug: slug,
      },
    };
  }

  const info = await lookupPublicChannel(slug);
  if (slug !== home.slug) rememberChannelMeta(slug, info.userId, info.chatroomId);
  return {
    slug,
    chatroomId: info.chatroomId,
    channelId: info.userId,
    broadcaster: {
      user_id: info.userId,
      username: slug,
      channel_slug: slug,
    },
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim().toLowerCase()).filter(Boolean))];
}
