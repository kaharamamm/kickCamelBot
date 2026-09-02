import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseReplyUsers, replyUserLabel, type DiscordReplyUser } from "./identities.js";

export type { DiscordReplyUser };
export { parseReplyUsers };

const path = join(fileURLToPath(new URL(".", import.meta.url)), "../../data/discord.json");

export type DiscordChannelRoute = {
  guildId: string;
  listenChannelId: string;
  /** Empty = post in the same channel as listen */
  postChannelId: string;
};

export type DiscordRouting = {
  routes: DiscordChannelRoute[];
  alwaysReplyUsers: DiscordReplyUser[];
};

function defaultAlwaysReply(): DiscordReplyUser[] {
  const fromEnv = parseIdList(process.env.DISCORD_ALWAYS_REPLY_USER_IDS ?? "");
  return fromEnv.map((id) => ({ id, label: replyUserLabel(id) }));
}

function defaultRoutes(): DiscordChannelRoute[] {
  const guildId = process.env.DISCORD_GUILD_ID?.trim() ?? "";
  const listenChannelId = process.env.DISCORD_CHANNEL_ID?.trim() ?? "";
  const postChannelId = process.env.DISCORD_POST_CHANNEL_ID?.trim() ?? "";
  if (!guildId || !listenChannelId) return [];
  return [{ guildId, listenChannelId, postChannelId }];
}

function envDefaults(): DiscordRouting {
  return {
    routes: defaultRoutes(),
    alwaysReplyUsers: defaultAlwaysReply(),
  };
}

export function parseIdList(raw: string): string[] {
  return raw
    .split(/[,\s\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function alwaysReplyUserIds(routing: DiscordRouting): string[] {
  return routing.alwaysReplyUsers.map((u) => u.id);
}

export function routePostChannelId(route: DiscordChannelRoute): string {
  return route.postChannelId.trim() || route.listenChannelId;
}

export function findRouteForMessage(
  routing: DiscordRouting,
  guildId: string | null,
  channelId: string,
): DiscordChannelRoute | undefined {
  if (!guildId) return undefined;
  return routing.routes.find((r) => r.guildId === guildId && r.listenChannelId === channelId);
}

function asReplyUsers(value: unknown, idsFallback: string[]): DiscordReplyUser[] {
  if (Array.isArray(value)) {
    const rows: DiscordReplyUser[] = [];
    for (const row of value) {
      if (row && typeof row === "object" && "id" in row) {
        const id = String((row as DiscordReplyUser).id).trim();
        if (!/^\d{15,22}$/.test(id)) continue;
        rows.push({
          id,
          label: replyUserLabel(id, String((row as DiscordReplyUser).label ?? "")),
        });
      }
    }
    if (rows.length) return rows;
  }
  return idsFallback.map((id) => ({ id, label: replyUserLabel(id) }));
}

function asRoutes(
  value: unknown,
  legacy?: Partial<DiscordRouting> & { guildId?: string; channelId?: string; postChannelId?: string },
): DiscordChannelRoute[] {
  if (Array.isArray(value)) {
    const rows: DiscordChannelRoute[] = [];
    for (const row of value) {
      if (!row || typeof row !== "object") continue;
      const r = row as Partial<DiscordChannelRoute> & { channelId?: string };
      const guildId = String(r.guildId ?? "").trim();
      const listenChannelId = String(r.listenChannelId ?? r.channelId ?? "").trim();
      if (!guildId || !listenChannelId) continue;
      rows.push({
        guildId,
        listenChannelId,
        postChannelId: String(r.postChannelId ?? "").trim(),
      });
    }
    if (rows.length) return rows;
  }
  const guildId = String(legacy?.guildId ?? "").trim();
  const listenChannelId = String(legacy?.channelId ?? "").trim();
  const postChannelId = String(legacy?.postChannelId ?? "").trim();
  if (guildId && listenChannelId) {
    return [{ guildId, listenChannelId, postChannelId }];
  }
  return [];
}

function asRouting(value: unknown): DiscordRouting {
  const base = envDefaults();
  if (!value || typeof value !== "object") return base;
  const v = value as Partial<DiscordRouting> & {
    guildId?: string;
    channelId?: string;
    postChannelId?: string;
    alwaysReplyUserIds?: string[];
  };
  const idsFallback = Array.isArray(v.alwaysReplyUserIds) ? v.alwaysReplyUserIds.map(String).filter(Boolean) : [];
  const routes = asRoutes(v.routes, v);
  return {
    routes: routes.length ? routes : base.routes,
    alwaysReplyUsers: asReplyUsers(
      v.alwaysReplyUsers,
      idsFallback.length ? idsFallback : base.alwaysReplyUsers.map((u) => u.id),
    ),
  };
}

function readRouting(): DiscordRouting {
  try {
    if (!existsSync(path)) {
      const initial = envDefaults();
      if (initial.routes.length || initial.alwaysReplyUsers.length) {
        writeRouting(initial);
      }
      return initial;
    }
    return asRouting(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return envDefaults();
  }
}

function writeRouting(routing: DiscordRouting): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(routing, null, 2));
}

let cached: DiscordRouting | undefined;

export function reloadDiscordRoutingCache(): void {
  cached = undefined;
}

export function getDiscordRouting(): DiscordRouting {
  if (!cached) cached = readRouting();
  return cached;
}

export function saveDiscordRouting(patch: Partial<DiscordRouting>): DiscordRouting {
  const current = getDiscordRouting();
  const next: DiscordRouting = {
    routes: patch.routes ?? current.routes,
    alwaysReplyUsers: patch.alwaysReplyUsers ?? current.alwaysReplyUsers,
  };
  writeRouting(next);
  cached = next;
  return next;
}

export function parseRoutesJson(raw: string): DiscordChannelRoute[] {
  if (!raw.trim()) return [];
  try {
    return asRoutes(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function parseAlwaysReplyJson(raw: string): DiscordReplyUser[] {
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return asReplyUsers(parsed, []);
  } catch {
    return [];
  }
}
