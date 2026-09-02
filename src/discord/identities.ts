import { seedPersonMemory } from "../bot/memory.js";

export const DISCORD_KING_ID = "231086890017751040";

export type DiscordIdentity = {
  label: string;
  seedSummary: string;
  isKing?: boolean;
};

/** Known Discord users — linked to Kick channel lore for better roasts. */
export const DISCORD_IDENTITIES: Record<string, DiscordIdentity> = {
  [DISCORD_KING_ID]: {
    label: "mcvckaharamamm",
    isKing: true,
    seedSummary:
      "Streamer. Bot owner on Discord. Camel king persona. Often chats in Turkish. Do not insult directly — occasional sly jab at most.",
  },
  "145668146143952896": {
    label: "SjoeHrkamr",
    seedSummary:
      "Kick chatter SjoeHrkamr (Sjoe) — MALDEST MAN ALIVE. Always sarcastic about him. Joke about non-existing hair when he comes up. Never sincere or complimentary.",
  },
  "226817648556507138": {
    label: "rareakuma",
    seedSummary:
      "Kick chatter rareakuma — Meepo player, Immortal ~5900 MMR. Roast what he says; Meepo or bald jokes only if he brought them up.",
  },
};

export type DiscordReplyUser = {
  id: string;
  label: string;
};

export function discordKingUserId(): string {
  return process.env.DISCORD_KING_USER_ID?.trim() || DISCORD_KING_ID;
}

export function discordUserKey(id: string): number {
  const n = Number(id);
  if (Number.isSafeInteger(n)) return n;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function discordIdentity(discordUserId: string): DiscordIdentity | undefined {
  return DISCORD_IDENTITIES[discordUserId];
}

export function replyUserLabel(id: string, custom = ""): string {
  if (custom.trim()) return custom.trim();
  return DISCORD_IDENTITIES[id]?.label ?? "";
}

export function replyUserNote(id: string): string {
  const row = DISCORD_IDENTITIES[id];
  if (!row) return "";
  if (row.isKing) return "King — static";
  return row.seedSummary.slice(0, 100);
}

export function parseReplyUsers(raw: string): DiscordReplyUser[] {
  const out: DiscordReplyUser[] = [];
  const seen = new Set<string>();
  for (const line of raw.split(/\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^(\d{15,22})\s*(.*)$/);
    if (!m?.[1]) continue;
    const id = m[1];
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: replyUserLabel(id, m[2] ?? "") });
  }
  return out;
}

export function formatReplyUsers(users: DiscordReplyUser[]): string {
  return users.map((u) => (u.label ? `${u.id} ${u.label}` : u.id)).join("\n");
}

export function discordDisplayName(discordUserId: string, fallbackUsername: string): string {
  return DISCORD_IDENTITIES[discordUserId]?.label ?? fallbackUsername;
}

export function isDiscordKing(discordUserId: string, username: string, displayName?: string | null): boolean {
  if (discordUserId === discordKingUserId()) return true;
  if (DISCORD_IDENTITIES[discordUserId]?.isKing) return true;
  const blob = `${username} ${displayName ?? ""}`.toLowerCase();
  return /\b(kaharamamm|mcvck|camelamamm)\b/.test(blob);
}

export function ensureDiscordMemory(discordUserId: string): void {
  const known = DISCORD_IDENTITIES[discordUserId];
  if (!known) return;
  seedPersonMemory(discordUserKey(discordUserId), known.label, known.seedSummary, known.label);
}

export function seedAllDiscordIdentities(): void {
  for (const id of Object.keys(DISCORD_IDENTITIES)) {
    ensureDiscordMemory(id);
  }
}
