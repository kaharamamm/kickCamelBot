import { PermissionFlagsBits } from "discord.js";
import { config } from "../config.js";

const STAFF_AND_VOICE =
  PermissionFlagsBits.ViewChannel |
  PermissionFlagsBits.SendMessages |
  PermissionFlagsBits.ReadMessageHistory |
  PermissionFlagsBits.Connect |
  PermissionFlagsBits.Speak |
  PermissionFlagsBits.MoveMembers |
  PermissionFlagsBits.MuteMembers |
  PermissionFlagsBits.DeafenMembers |
  PermissionFlagsBits.KickMembers |
  PermissionFlagsBits.BanMembers |
  PermissionFlagsBits.ModerateMembers;

export const DISCORD_INVITE_PERMISSIONS = String(STAFF_AND_VOICE);

export function discordInviteUrl(clientId?: string): string | null {
  const id = (clientId ?? config.discord.clientId).trim();
  if (!id) return null;
  const params = new URLSearchParams({
    client_id: id,
    scope: "bot",
    permissions: DISCORD_INVITE_PERMISSIONS,
  });
  return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
}
