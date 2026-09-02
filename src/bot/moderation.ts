import { deleteChatMessage, timeoutOrBan } from "../kick/api.js";
import { recentLines } from "./chatLog.js";
import { isChatBot } from "./bots.js";
import { logMod } from "./modlog.js";
import { say } from "./outbox.js";
import { noteBotSpoke } from "./engagement.js";
import { isStaff } from "./permissions.js";
import { bumpSpam, bumpStrike } from "./viewers.js";
import type { IncomingChat } from "../types.js";

const HARD = [
  "nigger",
  "nigga",
  "faggot",
  "retard",
  "rape",
  "rapist",
  "pedophile",
  "pedo",
  "child porn",
  "childporn",
  "orospu cocugu",
  "orospu çocuğu",
  "orospucocugu",
  "orospuevladi",
  "orospu evladı",
  "ananisik",
  "ananı sik",
  "anani sik",
  "bacını sik",
  "bacini sik",
  "gavat",
  "pezevenk",
  "ibne",
];

const MINOR = ["child porn", "childporn", "pedophile", "pedo", "çocuk porno", "cocuk porno"];

export async function moderateChat(chat: IncomingChat): Promise<boolean> {
  if (isStaff(chat.sender, chat.broadcaster)) return false;
  if (isChatBot(chat.sender)) return false;
  if (!chat.sender.user_id || !chat.messageId) return false;

  const text = chat.content || "";
  const folded = fold(text);

  if (MINOR.some((w) => hasPhrase(folded, w))) {
    const reason = "sexual content involving minors";
    await deleteChatMessage(chat.messageId);
    await timeoutOrBan(chat.broadcaster.user_id, chat.sender.user_id, null, reason);
    logMod({
      action: "ban",
      username: chat.sender.username,
      userId: chat.sender.user_id,
    message: text,
      reason,
      detail: "message deleted then perma",
    });
    await announce(
      chat,
      `@${chat.sender.username} perma banned. Reason: ${reason}.`,
    );
    console.log("[mod] perma (minor/sexual)", chat.sender.username);
    return true;
  }

  const spam = detectSpam(chat, folded);
  if (spam) {
    await deleteChatMessage(chat.messageId);
    const hits = bumpSpam(chat.sender.user_id, chat.sender.username);
    if (hits >= 2 || spam === "raid") {
      const reason =
        spam === "raid"
          ? "bot raid — same copy-paste from multiple accounts"
          : spam === "flood"
            ? "message flood"
            : "repeated copy-paste spam";
      await timeoutOrBan(chat.broadcaster.user_id, chat.sender.user_id, null, reason);
      logMod({
        action: "ban",
        username: chat.sender.username,
        userId: chat.sender.user_id,
    message: text,
        reason,
        detail: `deleted then perma (${spam})`,
      });
      await announce(chat, `@${chat.sender.username} perma banned. Reason: ${reason}.`);
      console.log("[mod] perma spam", chat.sender.username, spam);
    } else {
      const reason = spam === "flood" ? "message flood" : "repeated identical messages";
      logMod({
        action: "warn",
        username: chat.sender.username,
        userId: chat.sender.user_id,
    message: text,
        reason,
        detail: "deleted, last warning",
      });
      await announce(
        chat,
        `@${chat.sender.username} message deleted. Reason: ${reason}. Last warning — next spam is a perma.`,
      );
    }
    return true;
  }

  if (!isHardToxic(folded)) return false;

  await deleteChatMessage(chat.messageId);
  const strikes = bumpStrike(chat.sender.user_id, chat.sender.username);
  if (strikes <= 1) {
    const reason = "hard language / racist or sexual terms";
    logMod({
      action: "delete",
      username: chat.sender.username,
      userId: chat.sender.user_id,
    message: text,
      reason,
      detail: "first strike, warning",
    });
    await announce(
      chat,
      `@${chat.sender.username} message deleted. Reason: ${reason}. Next one is a 1 hour timeout.`,
    );
  } else if (strikes === 2) {
    const reason = "second hard-language strike";
    await timeoutOrBan(chat.broadcaster.user_id, chat.sender.user_id, 60, reason);
    logMod({
      action: "timeout",
      username: chat.sender.username,
      userId: chat.sender.user_id,
    message: text,
      reason,
      detail: "1 hour",
    });
    await announce(
      chat,
      `@${chat.sender.username} timed out 1 hour. Reason: ${reason}. One more is a perma.`,
    );
  } else {
    const reason = "third hard-language strike";
    await timeoutOrBan(chat.broadcaster.user_id, chat.sender.user_id, null, reason);
    logMod({
      action: "ban",
      username: chat.sender.username,
      userId: chat.sender.user_id,
    message: text,
      reason,
      detail: "perma",
    });
    await announce(chat, `@${chat.sender.username} perma banned. Reason: ${reason}.`);
  }
  console.log("[mod] toxic strike", strikes, chat.sender.username);
  return true;
}

async function announce(chat: IncomingChat, line: string): Promise<void> {
  noteBotSpoke(chat.broadcaster.user_id);
  await say(line, undefined, chat.broadcaster.user_id);
}

function isHardToxic(folded: string): boolean {
  return HARD.some((w) => hasPhrase(folded, w));
}

function hasPhrase(folded: string, phrase: string): boolean {
  const p = fold(phrase);
  if (!p) return false;
  return (` ${folded} `).includes(` ${p} `);
}

function detectSpam(chat: IncomingChat, folded: string): "repeat" | "flood" | "raid" | null {
  const recent = recentLines(chat.broadcaster.user_id, 25_000);
  const mine = recent.filter((l) => l.userId === chat.sender.user_id);
  const same = mine.filter((l) => fold(l.text) === folded && folded.length >= 8).length;
  if (same >= 3) return "repeat";
  if (mine.length >= 6) return "flood";

  if (folded.length >= 10) {
    const copies = recent.filter((l) => fold(l.text) === folded);
    const users = new Set(copies.map((l) => l.userId));
    if (users.size >= 3 && copies.length >= 3) return "raid";
  }
  return null;
}

function fold(value: string): string {
  return value
    .toLocaleLowerCase("tr-TR")
    .replace(/[@#._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
