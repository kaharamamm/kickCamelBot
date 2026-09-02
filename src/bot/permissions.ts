import type { KickActor } from "../types.js";

const STAFF_BADGES = new Set(["broadcaster", "moderator"]);

export function isStaff(sender: KickActor, broadcaster: KickActor): boolean {
  if (sender.user_id === broadcaster.user_id) return true;
  const badges = sender.identity?.badges ?? [];
  return badges.some((badge) => STAFF_BADGES.has(badge.type));
}

export function badgeSummary(sender: KickActor): string {
  const badges = sender.identity?.badges ?? [];
  if (badges.length === 0) return "viewer";
  return badges.map((b) => b.type).join(", ");
}

export function isVerifiedStreamer(sender: KickActor): boolean {
  if (sender.is_verified) return true;
  return (sender.identity?.badges ?? []).some((badge) => {
    const t = `${badge.type} ${badge.text}`.toLowerCase();
    return t.includes("verified") || badge.type === "og";
  });
}

export function isTheKing(actor: KickActor): boolean {
  if (actor.user_id === 549839) return true;
  const name = (actor.username || "").toLowerCase();
  const slug = (actor.channel_slug || "").toLowerCase();
  return ["mcvckaharamamm", "kaharamamm", "camelamamm"].includes(name) || ["mcvckaharamamm", "kaharamamm", "camelamamm"].includes(slug);
}

export function displayName(actor: KickActor): string {
  return actor.username || actor.channel_slug || "viewer";
}
