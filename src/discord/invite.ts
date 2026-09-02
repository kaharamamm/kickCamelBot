import { config } from "../config.js";

/** View Channels + Send Messages + Read Message History */
export const DISCORD_INVITE_PERMISSIONS = "68608";

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
