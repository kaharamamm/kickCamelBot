import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { replyUserLabel, type DiscordReplyUser } from "./identities.js";

export type { DiscordReplyUser };
export { parseReplyUsers } from "./identities.js";

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

/** First-time file seed only — never used to refill after the user clears routes. */
function bootstrapRoutes(): DiscordChannelRoute[] {
  const guildId = process.env.DISCORD_GUILD_ID?.trim() ?? "";
  const listenChannelId = process.env.DISCORD_CHANNEL_ID?.trim() ?? "";
  const postChannelId = process.env.DISCORD_POST_CHANNEL_ID?.trim() ?? "";
  if (!guildId || !listenChannelId) return [];
  return [{ guildId, listenChannelId, postChannelId }];
}

function bootstrapRouting(): DiscordRouting {
  return {
    routes: bootstrapRoutes(),
    alwaysReplyUsers: [],
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

/** Parse reply users. Empty array means intentionally cleared (king is re-added separately). */
function asReplyUsers(value: unknown): DiscordReplyUser[] {
  if (!Array.isArray(value)) return [];
  const rows: DiscordReplyUser[] = [];
  const seen = new Set<string>();
  for (const row of value) {
    let id = "";
    let label = "";
    if (row && typeof row === "object" && "id" in row) {
      id = String((row as DiscordReplyUser).id).trim();
      label = String((row as DiscordReplyUser).label ?? "");
    } else if (typeof row === "string" || typeof row === "number") {
      id = String(row).trim();
    }
    if (!/^\d{15,22}$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    rows.push({ id, label: replyUserLabel(id, label) });
  }
  return rows;
}

/** Parse routes. Empty array means intentionally cleared — never fall back to env. */
function asRoutes(
  value: unknown,
  legacy?: { guildId?: string; channelId?: string; postChannelId?: string },
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
    return rows;
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
  if (!value || typeof value !== "object") {
    return bootstrapRouting();
  }
  const v = value as Partial<DiscordRouting> & {
    guildId?: string;
    channelId?: string;
    postChannelId?: string;
    alwaysReplyUserIds?: string[];
  };

  // Explicit arrays in the file win — including empty.
  // Never re-fill from DISCORD_ALWAYS_REPLY_USER_IDS / env guild after the file exists.
  const routes = Array.isArray(v.routes) ? asRoutes(v.routes) : asRoutes(undefined, v);

  let alwaysReplyUsers: DiscordReplyUser[];
  if (Array.isArray(v.alwaysReplyUsers)) {
    alwaysReplyUsers = asReplyUsers(v.alwaysReplyUsers);
  } else if (Array.isArray(v.alwaysReplyUserIds)) {
    // Legacy key only — still do not merge env.
    alwaysReplyUsers = asReplyUsers(v.alwaysReplyUserIds);
  } else {
    alwaysReplyUsers = [];
  }

  return {
    routes,
    alwaysReplyUsers,
  };
}

function readRouting(): DiscordRouting {
  try {
    if (!existsSync(path)) {
      const initial = bootstrapRouting();
      writeRouting(initial);
      return initial;
    }
    return asRouting(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return bootstrapRouting();
  }
}

function writeRouting(routing: DiscordRouting): void {
  mkdirSync(dirname(path), { recursive: true });
  const normalized: DiscordRouting = {
    routes: routing.routes,
    alwaysReplyUsers: routing.alwaysReplyUsers,
  };
  writeFileSync(path, JSON.stringify(normalized, null, 2));
  console.log(
    `[discord] wrote ${normalized.routes.length} route(s), ${normalized.alwaysReplyUsers.length} always-reply user(s)`,
  );
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
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? asRoutes(parsed) : [];
  } catch {
    return [];
  }
}

export function parseAlwaysReplyJson(raw: string): DiscordReplyUser[] {
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? asReplyUsers(parsed) : [];
  } catch {
    return [];
  }
}

export function routesFromUnknown(value: unknown): DiscordChannelRoute[] {
  return asRoutes(value);
}

export function alwaysReplyFromUnknown(value: unknown): DiscordReplyUser[] {
  return asReplyUsers(value);
}
