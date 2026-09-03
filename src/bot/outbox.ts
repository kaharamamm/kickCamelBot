import { loadBotTokens } from "../auth/tokenStore.js";
import { config } from "../config.js";
import { sendChat } from "../kick/api.js";
import { rememberLine } from "./chatLog.js";

const recentBotMessages = new Set<string>();
const recentBotTexts = new Set<string>();
const repliedTo = new Set<string>();

type Ticket = {
  seq: number;
  channelId: number;
  replyTo?: string;
  ready?: Promise<string | null | undefined>;
  settled: boolean;
};

let nextSeq = 0;
const tickets: Ticket[] = [];
let pumping = false;

export function wasBotMessage(id: string): boolean {
  if (!id) return false;
  return recentBotMessages.has(id) || recentBotMessages.has(String(id));
}

export function wasBotText(text?: string): boolean {
  const finger = botTextFinger(text);
  if (!finger) return false;
  if (recentBotTexts.has(finger)) return true;
  const head = finger.slice(0, 40);
  if (head.length < 12) return false;
  for (const known of recentBotTexts) {
    if (known.startsWith(head) || finger.startsWith(known.slice(0, 40))) return true;
  }
  return false;
}

function botTextFinger(text?: string): string {
  return (text || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export function alreadyReplyingTo(messageId?: string): boolean {
  return Boolean(messageId && repliedTo.has(String(messageId)));
}

function claimReplyTo(replyTo?: string): boolean {
  if (!replyTo) return true;
  const key = String(replyTo);
  if (repliedTo.has(key)) return false;
  repliedTo.add(key);
  setTimeout(() => repliedTo.delete(key), 60_000);
  return true;
}

export function takeTicket(channelId: number, replyTo?: string): Ticket {
  const ticket: Ticket = { seq: ++nextSeq, channelId, replyTo, settled: false };
  tickets.push(ticket);
  return ticket;
}

export function fillTicket(ticket: Ticket, ready: Promise<string | null | undefined>): void {
  if (ticket.settled) return;
  if (ticket.replyTo && !claimReplyTo(ticket.replyTo)) {
    ticket.ready = Promise.resolve(undefined);
  } else {
    ticket.ready = ready.then(
      (line) => line,
      (err) => {
        console.warn("[chat] send-queue job failed", err);
        return null;
      },
    );
  }
  ticket.settled = true;
  void pump();
}

export function skipTicket(ticket: Ticket): void {
  if (ticket.settled) return;
  ticket.settled = true;
  ticket.ready = undefined;
  void pump();
}

async function post(content: string, replyTo?: string, broadcasterUserId?: number): Promise<void> {
  try {
    const id = await sendChat(content, replyTo, broadcasterUserId);
    if (id) {
      recentBotMessages.add(String(id));
      setTimeout(() => recentBotMessages.delete(String(id)), 5 * 60_000);
    }
    const finger = botTextFinger(content);
    if (finger) {
      recentBotTexts.add(finger);
      setTimeout(() => recentBotTexts.delete(finger), 5 * 60_000);
    }
    rememberOwnSay(content, broadcasterUserId);
  } catch (err) {
    console.warn("[chat] send failed", err);
  }
  await wait(250);
}

async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    while (true) {
      tickets.sort((a, b) => a.seq - b.seq);
      const blocked = new Set<number>();
      let picked: Ticket | undefined;
      for (const ticket of tickets) {
        if (blocked.has(ticket.channelId)) continue;
        if (!ticket.settled) {
          blocked.add(ticket.channelId);
          continue;
        }
        picked = ticket;
        break;
      }
      if (!picked) break;
      const idx = tickets.indexOf(picked);
      if (idx >= 0) tickets.splice(idx, 1);
      if (picked.ready) {
        const content = (await picked.ready)?.trim();
        if (content) await post(content, picked.replyTo, picked.channelId);
      }
    }
  } catch (err) {
    console.warn("[chat] queue error", err);
  } finally {
    pumping = false;
    const ready = tickets.some((t) => {
      if (!t.settled) return false;
      return !tickets.some((y) => y.channelId === t.channelId && y.seq < t.seq && !y.settled);
    });
    if (ready) void pump();
  }
}

export function say(content: string, replyTo?: string, broadcasterUserId?: number): Promise<void> {
  const ticket = takeTicket(broadcasterUserId ?? 0, replyTo);
  fillTicket(ticket, Promise.resolve(content));
  return Promise.resolve();
}

function rememberOwnSay(content: string, broadcasterUserId?: number): void {
  if (!broadcasterUserId) return;
  const bot = loadBotTokens()?.user;
  rememberLine(broadcasterUserId, {
    at: Date.now(),
    user: bot?.name || config.bot.name,
    userId: bot?.user_id ?? -1,
    text: content,
    raw: content,
    bot: true,
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
