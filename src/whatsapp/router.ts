import { isJidGroup, type WAMessage, type WASocket } from "@whiskeysockets/baileys";
import { asksAboutStreamer, calledTheBot, calledTheMods, replyWithAi } from "../bot/ai.js";
import { botFail, botOk, botThink } from "../bot/activityLog.js";
import { rememberThread, stillTalkingToUs } from "../bot/conversation.js";
import { noteExchange, rememberPerson } from "../bot/memory.js";
import {
  chatIsAllowlisted,
  extractWhatsAppText,
  getWhatsAppSelfJids,
  isWhatsAppSelfChat,
  noteWhatsAppSeen,
  sendWhatsAppImage,
  sendWhatsAppText,
  waUserKey,
  whatsappStatus,
} from "./client.js";
import { isWhatsAppPaused } from "./settings.js";
import { hasWhatsAppBotCue, meantForWhatsAppBot, messageTagsOwner, shouldReplyInWhatsAppGroup } from "./address.js";
import { noteWhatsAppEmojisFromText } from "./emotes.js";
import { generateWhatsAppImage, parseWhatsAppDrawRequest } from "./draw.js";

function senderJid(msg: WAMessage): string {
  if (msg.key.participant) return msg.key.participant;
  return msg.key.remoteJid ?? "";
}

function displayName(msg: WAMessage, jid: string): string {
  const push = (msg.pushName || "").trim();
  if (push) return push;
  const bare = jid.split("@")[0]?.split(":")[0] ?? jid;
  return bare || "someone";
}

/**
 * Allowlist-only WhatsApp replies.
 * Groups: Kick-style bot address — bare @tag of the owner is ignored; need bot/CamelBot
 * (and actual bot intent), or a short follow-up after we already replied.
 * Allowlisted 1:1 (other people): reply to every message.
 * Message-yourself: same bot-cue rules as groups (so normal notes to yourself stay quiet).
 */
export async function handleWhatsAppMessage(_socket: WASocket, msg: WAMessage): Promise<void> {
  if (isWhatsAppPaused()) {
    console.log("[whatsapp] skip paused");
    return;
  }

  const chatId = msg.key.remoteJid;
  if (!chatId) return;
  if (!chatIsAllowlisted(chatId)) {
    console.log(`[whatsapp] skip not allowlisted jid=${chatId}`);
    return;
  }

  const content = extractWhatsAppText(msg);
  if (!content) {
    console.log(`[whatsapp] skip empty text jid=${chatId}`);
    return;
  }
  noteWhatsAppEmojisFromText(content);

  const from = senderJid(msg);
  if (!from) return;

  const group = isJidGroup(chatId);
  const selfChat = isWhatsAppSelfChat(chatId);
  const who = selfChat ? "you" : displayName(msg, from);
  const userKey = waUserKey(from);
  const roomId = chatId;

  rememberPerson({ user_id: userKey, username: who }, content, { source: "whatsapp" });

  const continuing = stillTalkingToUs(roomId, userKey, content, undefined, false);
  const taggedOwner = messageTagsOwner(msg, getWhatsAppSelfJids(), whatsappStatus().phone);
  const calledBot = calledTheBot(content);

  if (group) {
    if (!shouldReplyInWhatsAppGroup({ content, taggedOwner, continuing })) {
      console.log(`[whatsapp] skip group gate jid=${chatId} text=${JSON.stringify(content.slice(0, 60))}`);
      return;
    }
  } else if (selfChat) {
    // Notes to yourself only wake the bot with bot/CamelBot cues (or follow-up).
    if (!continuing && !(hasWhatsAppBotCue(content) && meantForWhatsAppBot(content))) {
      console.log(`[whatsapp] skip self gate text=${JSON.stringify(content.slice(0, 60))}`);
      return;
    }
  }

  noteWhatsAppSeen();
  botThink("whatsapp", `${who}: ${content.slice(0, 100)}`);
  console.log(
    `[whatsapp] ${group ? "group" : selfChat ? "self" : "dm"} ${who}${taggedOwner ? " (tagged owner)" : ""}: ${content.slice(0, 80)}`,
  );

  // TEMP: always Turkish — language detector was misfiring
  const lang = "tr" as const;

  try {
    const drawPrompt = parseWhatsAppDrawRequest(content);
    if (drawPrompt) {
      botThink("whatsapp", `Drawing: ${drawPrompt.slice(0, 80)}`);
      await sendWhatsAppText(
        chatId,
        `*parmaklarını çıtlatır* Tamam çiziyorum ama bu yaratıcılık seviyesi utanç verici: ${drawPrompt}`,
      );
      const drawn = await generateWhatsAppImage(drawPrompt);
      if (!drawn.ok) {
        await sendWhatsAppText(chatId, drawn.error);
        botFail("whatsapp", drawn.error);
        return;
      }
      const caption = `*alaycı bakar* Buyur, makineye “${drawn.prompt}” çizdirdin. Gurur duy.`;
      const ok = await sendWhatsAppImage(chatId, drawn.buffer, {
        caption,
        mime: drawn.mime,
      });
      if (!ok) {
        botFail("whatsapp", "Image send failed");
        await sendWhatsAppText(chatId, "Görseli gönderemedim.");
        return;
      }
      noteExchange(userKey, who, content, `[image] ${drawn.prompt}`, { source: "whatsapp" });
      rememberThread(roomId, userKey);
      botOk("whatsapp", `Drew for ${who}: ${drawn.prompt.slice(0, 60)}`);
      return;
    }

    const reply = await replyWithAi(
      {
        sender: { user_id: userKey, username: who },
        content,
        broadcaster: { user_id: userKey },
      },
      {
        force: true,
        continuing,
        calledBot: calledBot && (group || selfChat),
        calledMods: calledTheMods(content),
        lang,
        // Only inject streamer facts when they actually asked — otherwise every reply
        // becomes "mcvckaharamamm is from Ankara…"
        allowKing: asksAboutStreamer(content),
        platform: "whatsapp",
      },
    );

    if (!reply) {
      console.log(`[whatsapp] AI returned empty for ${who}`);
      return;
    }

    const ok = await sendWhatsAppText(chatId, reply);
    if (!ok) {
      botFail("whatsapp", "Send failed");
      return;
    }

    noteExchange(userKey, who, content, reply, { source: "whatsapp" });
    rememberThread(roomId, userKey);
    botOk("whatsapp", `Replied to ${who}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    botFail("whatsapp", message);
    console.warn("[whatsapp] reply failed", err);
  }
}
