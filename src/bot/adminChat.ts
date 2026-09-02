import { loadTokens } from "../auth/tokenStore.js";
import { getMyChannel } from "../kick/api.js";
import { rememberLine } from "./chatLog.js";
import { handleCommand } from "./commands.js";
import { handleStaffModAsk } from "./chatModes.js";
import { detectLang } from "./lang.js";
import { runKingOrder } from "./kingOrder.js";
import { replyWithAi } from "./ai.js";
import { config } from "../config.js";
import type { ChatMessageEvent, IncomingChat } from "../types.js";

export type AdminChatLine = {
  id: string;
  at: number;
  role: "user" | "bot" | "system";
  text: string;
  error?: boolean;
};

const KING_ID = 549839;
const KING_NAME = "mcvckaharamamm";
const MAX_LINES = 120;

const lines: AdminChatLine[] = [];

export function adminChatHistory(): AdminChatLine[] {
  return [...lines];
}

export function clearAdminChat(): AdminChatLine[] {
  lines.length = 0;
  return adminChatHistory();
}

function push(role: AdminChatLine["role"], text: string, error = false): AdminChatLine {
  const line: AdminChatLine = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: Date.now(),
    role,
    text,
    ...(error ? { error: true } : {}),
  };
  lines.push(line);
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
  return line;
}

function kingIncoming(content: string, home: { broadcaster_user_id: number; slug: string }): IncomingChat {
  return {
    messageId: `admin-${Date.now()}`,
    content,
    sender: {
      user_id: KING_ID,
      username: KING_NAME,
      channel_slug: home.slug,
    },
    broadcaster: {
      user_id: home.broadcaster_user_id,
      username: home.slug,
      channel_slug: home.slug,
    },
  };
}

function silentOk(action: string): string {
  return `✓ ${action}`;
}

function isErrorReply(text: string): boolean {
  if (text.startsWith("✓")) return false;
  return /\b(could not|couldn't|cannot|can't|failed|error|not in my list|kayıtlı|silinemedi|yazılamadı|değişmedi|boş|empty|ne yazayım|what title|say what)\b/i.test(
    text,
  );
}

/** Process a dashboard admin chat line — same powers as king in home Kick chat. */
export async function processAdminChat(content: string): Promise<AdminChatLine> {
  const trimmed = content.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return push("system", "Type a command or message first.", true);
  }

  if (!loadTokens()?.accessToken) {
    push("user", trimmed);
    return push("system", "Streamer not logged in. Open /login on this dashboard first.", true);
  }

  push("user", trimmed);

  try {
    const home = await getMyChannel();
    rememberLine(home.broadcaster_user_id, {
      at: Date.now(),
      user: KING_NAME,
      userId: KING_ID,
      text: trimmed,
      raw: trimmed,
    });
    const lang = detectLang(trimmed, KING_ID);
    const incoming = kingIncoming(trimmed, home);

    if (trimmed.startsWith(config.bot.prefix)) {
      const reply = await handleCommand(incoming);
      if (reply !== null) {
        const text = reply.trim() || silentOk("Command ran.");
        return push("bot", text, isErrorReply(text));
      }
    }

    const orderResult = await runKingOrder(trimmed, lang, home.broadcaster_user_id);
    if (orderResult !== undefined) {
      const text = orderResult ?? silentOk("Order executed.");
      return push("bot", text, !!orderResult);
    }

    const staff = await handleStaffModAsk(incoming);
    if (staff !== null) {
      const text = staff.trim() || silentOk("Mod action done.");
      return push("bot", text, isErrorReply(text));
    }

    const ai = await replyWithAi(
      { sender: incoming.sender, content: trimmed, broadcaster: incoming.broadcaster },
      { force: true, lang, allowKing: true, calledBot: true },
    );
    if (ai?.trim()) {
      return push("bot", ai.trim());
    }

    return push("system", "No reply. Try a clearer order or @CamelBot.", true);
  } catch (err) {
    console.warn("[admin-chat]", err);
    return push("system", err instanceof Error ? err.message : "Admin chat failed.", true);
  }
}

export function buildAdminChatEvent(content: string, home: { broadcaster_user_id: number; slug: string }): ChatMessageEvent {
  return {
    message_id: `admin-${Date.now()}`,
    content,
    broadcaster: {
      user_id: home.broadcaster_user_id,
      username: home.slug,
      channel_slug: home.slug,
    },
    sender: {
      user_id: KING_ID,
      username: KING_NAME,
      channel_slug: home.slug,
    },
  };
}
