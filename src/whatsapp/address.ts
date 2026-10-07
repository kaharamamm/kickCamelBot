import { getContentType, jidNormalizedUser, type WAMessage } from "@whiskeysockets/baileys";
import { calledTheBot, looksLikeQuestion, mentionsCamelBot, shouldTalkToAi } from "../bot/ai.js";
import { config } from "../config.js";
import { parseWhatsAppDrawRequest } from "./draw.js";

/** Bot-address cues (CamelBot / camelbot / cambot / camel / bot…). */
export function hasWhatsAppBotCue(content: string): boolean {
  if (mentionsCamelBot(content) || shouldTalkToAi(content)) return true;
  if (calledTheBot(content)) return true;
  if (/\bcamel\s*bot\b/i.test(content)) return true;
  const name = config.bot.name.toLowerCase();
  const t = content.toLowerCase();
  if (name && (t.includes(name) || t.includes(`@${name}`))) return true;
  return false;
}

/**
 * True when the sentence is actually directed at the bot — not a casual "bot" in another topic.
 * Tagging the human owner alone never counts (caller must require a bot cue with that tag).
 */
export function meantForWhatsAppBot(content: string): boolean {
  const t = content.replace(/\s+/g, " ").trim();
  if (!t) return false;

  // Draw/çiz orders always count — execute the command even if wording is messy
  if (parseWhatsAppDrawRequest(t)) return true;

  if (!hasWhatsAppBotCue(t)) return false;

  // Direct address at start: "bot …", "CamelBot …", "cambot …", "@camel …"
  if (
    /^(?:[@]?\s*)?(?:camel[\s_-]*bots?|cambot|camlbot|camlebot|camebot|camelbt|kamelbot|camalbot|camel|bots?(?:u|lar|um)?)\b/i.test(
      t,
    )
  ) {
    return true;
  }

  // Name / @camel / fuzzy CamelBot
  if (mentionsCamelBot(t) || shouldTalkToAi(t)) return true;

  // Question or ask verbs near a bot cue
  if (looksLikeQuestion(t)) return true;
  if (
    /\b(bot|camelbot|cambot|camel)\b/i.test(t) &&
    /\b(söyle|soyle|anlat|yap|bak|gel|cevapla|cevap|answer|reply|tell|say|what|why|how|who|when|where|ne |niye|neden|nasıl|nasil|kim|kaç|kac|kaçta|kacta|çiz|ciz|draw)\b/i.test(
      t,
    )
  ) {
    return true;
  }

  // Short bot-call lines ("bot sa", "botsu naber") — Kick treats these as addressed
  if (calledTheBot(t) && t.length <= 140) return true;

  // Long message that only drops "bot" once with no ask → ignore
  if (calledTheBot(t) && t.length > 160 && !/[?؟]/.test(t)) return false;

  return hasWhatsAppBotCue(t) && t.length <= 160;
}

function contextInfo(msg: WAMessage): { mentionedJid?: string[] | null } | undefined {
  const content = msg.message;
  if (!content) return undefined;
  const type = getContentType(content);
  if (!type) return undefined;
  const node = content[type] as { contextInfo?: { mentionedJid?: string[] | null } } | undefined;
  if (node && typeof node === "object" && node.contextInfo) return node.contextInfo;
  return content.extendedTextMessage?.contextInfo ?? undefined;
}

/** True if this WhatsApp message @-tagged our linked account (the human phone CamelBot shares). */
export function messageTagsOwner(msg: WAMessage, selfJids: string[], phoneDigits?: string | null): boolean {
  const self = new Set(selfJids.map((j) => jidNormalizedUser(j)).filter(Boolean));
  for (const j of selfJids) self.add(j);

  const ctx = contextInfo(msg);
  for (const jid of ctx?.mentionedJid ?? []) {
    const n = jidNormalizedUser(jid);
    if (self.has(n) || self.has(jid)) return true;
    if (phoneDigits) {
      const bare = n.split("@")[0]?.split(":")[0] ?? "";
      if (bare && (bare === phoneDigits || bare.endsWith(phoneDigits) || phoneDigits.endsWith(bare))) {
        return true;
      }
    }
  }

  if (phoneDigits && phoneDigits.length >= 8) {
    const text = String(
      msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        "",
    );
    // Soft match: @905… or last 10 digits appear after @
    const last10 = phoneDigits.slice(-10);
    if (last10 && new RegExp(`@\\s*\\+?\\d*${last10}\\b`).test(text.replace(/[\s-]/g, ""))) {
      return true;
    }
  }
  return false;
}

/**
 * Group gate: never answer a bare @tag of the owner.
 * Answer when they use bot words and mean the bot, or when continuing a bot thread.
 * Tag+bot words also counts.
 */
export function shouldReplyInWhatsAppGroup(params: {
  content: string;
  taggedOwner: boolean;
  continuing: boolean;
}): boolean {
  if (params.continuing) return true;
  // Commands like çiz/draw always wake the bot in allowlisted groups
  if (parseWhatsAppDrawRequest(params.content)) return true;
  if (!hasWhatsAppBotCue(params.content)) return false;
  // Tagged the human: only if they also used bot cues (already required) and meant the bot
  if (params.taggedOwner) return meantForWhatsAppBot(params.content);
  // No tag — bot words in chat, must look directed at the bot
  return meantForWhatsAppBot(params.content);
}
