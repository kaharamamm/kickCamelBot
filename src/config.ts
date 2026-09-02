import "dotenv/config";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name} in .env`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : fallback;
}

export const config = {
  port: Number(optional("PORT", "3000")),
  kick: {
    clientId: required("KICK_CLIENT_ID"),
    clientSecret: process.env.KICK_CLIENT_SECRET?.trim() ?? "",
    redirectUri: optional("KICK_REDIRECT_URI", "http://localhost:3000/callback"),
    webhookPath: optional("KICK_WEBHOOK_PATH", "/webhooks/kick"),
    apiBase: "https://api.kick.com/public/v1",
    idBase: "https://id.kick.com",
    scopes: [
      "user:read",
      "channel:read",
      "channel:write",
      "chat:write",
      "events:subscribe",
      "kicks:read",
      "channel:rewards:read",
      "channel:rewards:write",
      "moderation:ban",
      "moderation:chat_message:manage",
    ],
  },
  bot: {
    name: optional("BOT_NAME", "CamelBot"),
    prefix: optional("COMMAND_PREFIX", "!"),
    chatroomId: Number(process.env.KICK_CHATROOM_ID ?? "") || 0,
    extraChannels: (process.env.KICK_EXTRA_CHANNELS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY?.trim() ?? "",
    model: optional("GEMINI_MODEL", "gemini-3.5-flash-lite"),
  },
  discord: {
    enabled: Boolean(process.env.DISCORD_BOT_TOKEN?.trim()),
    token: process.env.DISCORD_BOT_TOKEN?.trim() ?? "",
    clientId: process.env.DISCORD_CLIENT_ID?.trim() ?? "",
    guildId: process.env.DISCORD_GUILD_ID?.trim() ?? "",
    channelId: process.env.DISCORD_CHANNEL_ID?.trim() ?? "",
    postChannelId: process.env.DISCORD_POST_CHANNEL_ID?.trim() ?? "",
    alwaysReplyUserIds: (process.env.DISCORD_ALWAYS_REPLY_USER_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  },
};

export function assertReadyForAuth(): void {
  if (!config.kick.clientSecret) {
    throw new Error(
      "KICK_CLIENT_SECRET is empty. Copy the Client Secret from Kick → Settings → Developer → CamelBot into .env (do not paste it in chat).",
    );
  }
}
