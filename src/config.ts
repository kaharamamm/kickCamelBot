import "dotenv/config";
import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";

/** Re-read .env so Dashboard → AI Refresh picks up keys without a full process restart. */
export function reloadEnv(): void {
  loadDotenv({ path: resolve(process.cwd(), ".env"), override: true });
}

export function envKey(name: string): string {
  return process.env[name]?.trim() ?? "";
}

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
    get apiKey() {
      return envKey("GEMINI_API_KEY");
    },
    get model() {
      return envKey("GEMINI_MODEL") || "gemini-3.5-flash-lite";
    },
  },
  openai: {
    get apiKey() {
      return envKey("OPENAI_API_KEY");
    },
  },
  groq: {
    get apiKey() {
      return envKey("GROQ_API_KEY");
    },
  },
  openrouter: {
    get apiKey() {
      return envKey("OPENROUTER_API_KEY");
    },
  },
  discord: {
    enabled: Boolean(process.env.DISCORD_BOT_TOKEN?.trim()),
    token: process.env.DISCORD_BOT_TOKEN?.trim() ?? "",
    clientId: process.env.DISCORD_CLIENT_ID?.trim() ?? "",
    guildId: process.env.DISCORD_GUILD_ID?.trim() ?? "",
    channelId: process.env.DISCORD_CHANNEL_ID?.trim() ?? "",
    postChannelId: process.env.DISCORD_POST_CHANNEL_ID?.trim() ?? "",
    alwaysReplyUserIds: [] as string[],
  },
};

export function assertReadyForAuth(): void {
  if (!config.kick.clientSecret) {
    throw new Error(
      "KICK_CLIENT_SECRET is empty. Copy the Client Secret from Kick → Settings → Developer → CamelBot into .env (do not paste it in chat).",
    );
  }
}
