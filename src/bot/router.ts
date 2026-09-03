import { loadBotTokens } from "../auth/tokenStore.js";
import { config } from "../config.js";
import { getMe, shortTimeout } from "../kick/api.js";
import { calledTheBot, calledTheMods, generateLine, replyWithAi, shouldTalkToAi, asksAboutStreamer } from "./ai.js";
import { isChatBot, isOwnBot, isOwnBotName, talkingToOtherBot } from "./bots.js";
import { rememberLine } from "./chatLog.js";
import { handleCommand, isDotaChatCommand } from "./commands.js";
import { answerDotaAsk, classifyDotaAsk, warmupDota } from "./dota.js";
import { maybeJoinEmoteSpam, maybeChaosEmoteSpam } from "./engagement.js";
import { ensureWarning, looksLikeBotInsult, noteHeat, timeoutRoast } from "./heat.js";
import { detectLang, isGreeting, otherLangReply } from "./lang.js";
import { channelLiveStatus } from "./liveState.js";
import { logMod } from "./modlog.js";
import { moderateChat } from "./moderation.js";
import { noteExchange, rememberPerson } from "./memory.js";
import { maybeTriggeredEmoteMode } from "./emoteMode.js";
import { handleStaffModAsk, maybeAutoClip } from "./chatModes.js";
import { notePossibleArgue } from "./argueWatch.js";
import { isStaff, isTheKing, isVerifiedStreamer } from "./permissions.js";
import { answerRecap, classifyRecapAsk, noteChat, noteDonation, noteFollow, noteRaid, noteStreamContext, noteSub, noteTalkedToUs } from "./recap.js";
import { currentPoll, tryBareVote } from "./polls.js";
import { fillTicket, skipTicket, say, takeTicket, wasBotMessage, wasBotText } from "./outbox.js";
import { enqueueWork } from "./workQueue.js";
import { tryAnswerQuiz } from "./quiz.js";
import { thanksOnce } from "./thanks.js";
import { markChat, takeVerifiedFirst } from "./viewers.js";
import { shouldTryKingOrder, runKingOrder } from "./kingOrder.js";
import { rememberThread, stillTalkingToUs } from "./conversation.js";
import { allowWebSearch, answerWebSearch, classifyWebSearch } from "./webSearch.js";
import { yenimahalleWeather } from "./weather.js";
import type { ChatMessageEvent, IncomingChat, KickUser } from "../types.js";

let botUser: KickUser | undefined;
const handledChat = new Set<string>();

export async function handleChatMessage(event: ChatMessageEvent): Promise<void> {
  const key = `kick:${event.broadcaster.user_id}`;
  return enqueueWork(key, () => processChatMessage(event));
}

async function processChatMessage(event: ChatMessageEvent): Promise<void> {
  const raw = event.content ?? "";
  const incoming: IncomingChat = {
    messageId: event.message_id,
    content: stripEmotes(raw),
    sender: event.sender,
    broadcaster: event.broadcaster,
    replyToId: event.replies_to?.message_id,
    replyToName: event.replies_to?.sender?.username,
    replyToContent: event.replies_to?.content,
    emotes: event.emotes,
  };
  if (alreadyHandledChat(incoming)) return;

  if (wasBotMessage(incoming.messageId)) return;
  if (isOwnBot(incoming.sender)) return;
  if (isChatBot(incoming.sender)) {
    if (raw || incoming.content) {
      rememberLine(incoming.broadcaster.user_id, {
        at: Date.now(),
        user: incoming.sender.username,
        userId: incoming.sender.user_id,
        text: incoming.content || raw,
        raw,
      });
    }
    if (await maybeThankRaid(incoming)) return;
    await maybeThankDonationAlert(incoming);
    const slug = incoming.broadcaster.channel_slug || incoming.broadcaster.username;
    const status = await channelLiveStatus(slug, incoming.broadcaster.user_id);
    if (status.chatterOk) await bullyOtherBot(incoming);
    return;
  }
  const botAccountId = loadBotTokens()?.user?.user_id;
  if (botAccountId && incoming.sender.user_id === botAccountId) return;

  const fromKing = isTheKing(incoming.sender);

  if (raw || incoming.content) {
    rememberLine(incoming.broadcaster.user_id, {
      at: Date.now(),
      user: incoming.sender.username,
      userId: incoming.sender.user_id,
      text: incoming.content || raw,
      raw,
    });
    rememberPerson(incoming.sender, incoming.content || raw);
  }

  const ticket = takeTicket(incoming.broadcaster.user_id, incoming.messageId);
  let handed = false;
  let pending: Promise<string | null | undefined> | undefined;
  const deliver = (ready: Promise<string | null | undefined>) => {
    handed = true;
    const tracked = ready.then(
      (line) => {
        // Any real reply (chat OR order ack/fail) keeps the conversation thread alive.
        if (line?.trim()) {
          rememberThread(incoming.broadcaster.user_id, incoming.sender.user_id);
        }
        return line;
      },
      (err) => {
        console.warn("[chat] reply job failed", err);
        return null;
      },
    );
    pending = tracked;
    fillTicket(ticket, tracked);
  };

  try {
    if (await moderateChat(incoming)) return;

    const slug = incoming.broadcaster.channel_slug || incoming.broadcaster.username;
    const status = await channelLiveStatus(slug, incoming.broadcaster.user_id);
    if (status.isHome) {
      noteStreamContext(status.game, status.startedAt, status.live);
      noteChat({
        username: incoming.sender.username,
        userId: incoming.sender.user_id,
        text: incoming.content || raw,
        raw,
        home: true,
        emotes: incoming.emotes,
      });
    }

    if (!incoming.content && !/\[emote:/i.test(raw) && !incoming.emotes) return;

    if (status.isHome && status.live) {
      void maybeAutoClip(incoming.broadcaster.user_id, true);
      void notePossibleArgue(incoming);
    }

    if (incoming.content.startsWith(config.bot.prefix)) {
      if (!status.isHome && !status.chatterOk && !isDotaChatCommand(incoming.content)) return;
      const commandReply = await handleCommand(incoming);
      if (commandReply !== null) {
        if (commandReply.trim()) deliver(Promise.resolve(commandReply));
        return;
      }
    }

    if (currentPoll(incoming.broadcaster.user_id) && tryBareVote(incoming.broadcaster.user_id, incoming.sender.user_id, incoming.content)) {
      return;
    }

    const verifiedFirst =
      isVerifiedStreamer(incoming.sender) && takeVerifiedFirst(incoming.sender.user_id, incoming.sender.username);

    if (status.isHome && status.chatterOk && incoming.content && !incoming.content.startsWith(config.bot.prefix)) {
      await maybeWelcome(incoming, verifiedFirst);
    }

    if (status.chatterOk) {
      if (!fromKing && (await tryAnswerQuiz(incoming))) return;
      const pingedBot = shouldTalkToAi(incoming.content) || calledTheBot(incoming.content);
      if (!fromKing && !pingedBot && (await maybeJoinEmoteSpam(incoming.broadcaster.user_id))) return;
      if (!fromKing && !pingedBot && (await maybeChaosEmoteSpam(incoming.broadcaster.user_id))) return;
    }

    if (!incoming.content) return;

    if (status.isHome && isStaff(incoming.sender, incoming.broadcaster)) {
      const staff = await handleStaffModAsk(incoming);
      if (staff !== null) {
        if (staff.trim()) deliver(Promise.resolve(staff));
        return;
      }
    }

    const dotaAsk = classifyDotaAsk(incoming.content);
    if (dotaAsk) {
      const facts = await answerDotaAsk(dotaAsk, slug, incoming.content, {
        live: status.live,
        startedAt: status.startedAt,
      });
      if (facts.trim()) {
        rememberPerson(incoming.sender);
        noteExchange(incoming.sender.user_id, incoming.sender.username, incoming.content, facts);
        deliver(Promise.resolve(facts));
      }
      return;
    }

    if (!status.isHome && !status.chatterOk && !fromKing) return;

    if (talkingToOtherBot(incoming.content) && !fromKing) return;

    const lang = detectLang(incoming.content, incoming.sender.user_id);
    const mentioned = shouldTalkToAi(incoming.content);
    const insulted = looksLikeBotInsult(incoming.content);
    const calledBot = calledTheBot(incoming.content);
    const calledMods = calledTheMods(incoming.content);
    const parentWasBot = isReplyToUs(incoming);
    const continuing = stillTalkingToUs(
      incoming.broadcaster.user_id,
      incoming.sender.user_id,
      incoming.content,
      incoming.replyToName,
      parentWasBot,
    );
    const addressed = mentioned || parentWasBot || calledBot || calledMods || continuing;
    const fromStaff = isStaff(incoming.sender, incoming.broadcaster);

    if (!status.chatterOk && !addressed) return;

    if (lang === "other") {
      if (!addressed) return;
      deliver(Promise.resolve(otherLangReply(incoming.sender.username)));
      return;
    }

    if (fromKing || fromStaff) {
      const tryOrder = shouldTryKingOrder({
        content: incoming.content,
        addressed,
        continuing,
      });
      if (tryOrder) {
        if (fromStaff && !fromKing && Math.random() < 1 / 100_000) {
          deliver(
            Promise.resolve(
              lang === "en"
                ? "Not now. I'm in a mood. Ask the king or try later."
                : "Şimdi olmaz. Keyfim yok. Krala sor ya da sonra dene.",
            ),
          );
          return;
        }
        try {
          const result = await runKingOrder(incoming.content, lang, incoming.broadcaster.user_id);
          if (result !== undefined) {
            if (result) deliver(Promise.resolve(result));
            else {
              // Silent order success (title change, Discord join+speak, etc.) — window starts now.
              rememberThread(incoming.broadcaster.user_id, incoming.sender.user_id);
            }
            return;
          }
          // Understood as chat — fall through to normal reply.
        } catch (err) {
          console.warn("[order] failed", err);
          // Don't go silent — answer in chat after an order crash.
        }
      }
      if (fromKing && addressed) {
        const self = selfAskReply(incoming.content, lang);
        if (self) {
          deliver(Promise.resolve(self));
          return;
        }
      }
      if (fromKing) {
        const kingSearch = classifyWebSearch(incoming.content);
        if (kingSearch) {
          deliver(answerWebSearch(kingSearch, lang, incoming.content));
          return;
        }
      }
    }

    let heatWarn = false;
    if (
      addressed &&
      !fromKing &&
      !isStaff(incoming.sender, incoming.broadcaster) &&
      looksLikeBotInsult(incoming.content)
    ) {
      const heat = noteHeat(incoming.broadcaster.user_id, incoming.sender.user_id, true);
      if (heat.timeoutNow) {
        await shortTimeout(
          incoming.broadcaster.user_id,
          incoming.sender.user_id,
          5000,
          "fun timeout",
        );
        logMod({
          action: "timeout",
          username: incoming.sender.username,
          userId: incoming.sender.user_id,
          reason: "fun 5s timeout",
          detail: "warned, then kept going",
          message: incoming.content,
        });
        deliver(Promise.resolve(timeoutRoast(incoming.sender.username, lang)));
        return;
      }
      heatWarn = heat.warnNow;
    }

    if (insulted && !fromKing && status.isHome) {
      void maybeTriggeredEmoteMode(incoming.broadcaster.user_id, true);
    }

    if (!addressed) return;

    if (!fromKing) {
      const search = classifyWebSearch(incoming.content);
      if (search && allowWebSearch(incoming.sender.user_id, false)) {
        deliver(answerWebSearch(search, lang, incoming.content));
        return;
      }
    }

    const recapKind = classifyRecapAsk(incoming.content);
    if (recapKind) {
      const recapLang = lang === "en" ? "en" : "tr";
      const recapLine = answerRecap(recapKind, recapLang);
      if (recapLine) {
        rememberPerson(incoming.sender);
        noteExchange(incoming.sender.user_id, incoming.sender.username, incoming.content, recapLine);
        noteTalkedToUs(incoming.sender.username, incoming.sender.user_id, incoming.content || raw);
        deliver(Promise.resolve(recapLine));
        return;
      }
    }

    const streamTitle = status.title;
    const game = status.game;

    deliver(
      replyWithAi(incoming, {
        parentWasBot,
        streamTitle,
        game,
        force: calledBot || calledMods || parentWasBot || continuing,
        continuing,
        lang,
        respectful: verifiedFirst && !fromKing,
        calledBot: calledBot && !fromKing && !insulted,
        calledMods,
        allowKing: fromKing || asksAboutStreamer(incoming.content),
        heatWarn: heatWarn && !fromKing,
        fromKing,
        kingMood: fromKing
          ? isGreeting(incoming.content)
            ? "plain"
            : insulted ||
                /\b(kızd[ıi]m|kizdim|sinirlendim|shut up|kapa|sus lan|hakaret|don't insult|özür)\b/i.test(incoming.content)
              ? "scared"
              : Math.random() < 0.3
                ? "sneak"
                : "plain"
          : undefined,
        insulted: insulted && !fromKing,
      }).then((aiReply) => {
        if (!aiReply) return null;
        const line = heatWarn ? ensureWarning(aiReply, lang) : aiReply;
        rememberPerson(incoming.sender);
        noteExchange(incoming.sender.user_id, incoming.sender.username, incoming.content, line);
        noteTalkedToUs(incoming.sender.username, incoming.sender.user_id, incoming.content || raw);
        rememberThread(incoming.broadcaster.user_id, incoming.sender.user_id);
        return line;
      }),
    );
  } finally {
    if (!handed) skipTicket(ticket);
  }
  if (pending) await pending;
}

const lastBotBully = new Map<number, number>();

async function bullyOtherBot(chat: IncomingChat): Promise<void> {
  const last = lastBotBully.get(chat.broadcaster.user_id) ?? 0;
  if (Date.now() - last < 90_000) return;
  lastBotBully.set(chat.broadcaster.user_id, Date.now());
  const line = await generateLine(
    [
      `Another bot named ${chat.sender.username} just wrote in chat: ${chat.content.slice(0, 120)}`,
      "Bully them sarcastically in one short line. Do not @mention them or say KickBot. You are the real bot here.",
    ].join("\n"),
  );
  if (line) await say(line, undefined, chat.broadcaster.user_id);
}

export async function handleFollow(username: string, broadcasterUserId?: number): Promise<void> {
  noteFollow(username);
  if (!thanksOnce(`follow:${username.toLowerCase()}`)) return;
  await say(`@${username} thanks for the follow!`, undefined, broadcasterUserId);
}

export async function handleRaid(params: {
  username: string;
  viewers?: number;
  broadcasterUserId?: number;
}): Promise<void> {
  const who = params.username.replace(/^@/, "").trim() || "raiders";
  noteRaid(who, params.viewers);
  if (!thanksOnce(`raid:${who.toLowerCase()}`, 120_000)) return;
  const n = Math.max(0, Math.floor(params.viewers ?? 0));
  const crowd = n > 0 ? ` with ${n} viewer${n === 1 ? "" : "s"}` : "";
  if (/^(raiders|someone)$/i.test(who)) {
    await say(`Thanks for the raid${crowd}! Welcome everyone who just landed.`, undefined, params.broadcasterUserId);
    return;
  }
  await say(
    `@${who} thanks for the raid${crowd}! Welcome raiders, make yourselves at home.`,
    undefined,
    params.broadcasterUserId,
  );
}

export async function handleNewSub(username: string, months?: number, broadcasterUserId?: number): Promise<void> {
  if (!username) return;
  noteSub(username, months);
  if (!thanksOnce(`sub:${username.toLowerCase()}`)) return;
  const extra = months && months > 1 ? ` (${months} months)` : "";
  await say(`@${username} thanks for the sub${extra}!`, undefined, broadcasterUserId);
}

export async function handleGiftSubs(params: {
  gifter?: string;
  count: number;
  anonymous?: boolean;
  broadcasterUserId?: number;
}): Promise<void> {
  const n = Math.max(1, Math.floor(params.count) || 1);
  if (!params.anonymous && params.gifter) noteSub(params.gifter);
  const key = `giftsub:${params.gifter ?? "anon"}:${n}`;
  if (!thanksOnce(key)) return;
  if (params.anonymous || !params.gifter) {
    await say(giftSubThanks("someone", n, true), undefined, params.broadcasterUserId);
    return;
  }
  await say(giftSubThanks(params.gifter, n, false), undefined, params.broadcasterUserId);
}

function giftSubThanks(who: string, count: number, anon: boolean): string {
  const n = Math.max(1, Math.floor(count));
  const name = anon ? "Someone" : `@${who}`;
  if (n <= 1) return `${name} gifted a sub. That's a real one. Thank you.`;
  if (n <= 4) return `${name} gifted ${n} subs!! The camels are smiling. Thank you king.`;
  if (n <= 9) return `${name} GIFTED ${n} SUBS. Absolute legend. The king noticed.`;
  return `${name} GIFTED ${n} SUBS. That's not a gift that's a raid of love. We don't deserve you. THANK YOU.`;
}

export async function handleKicksGift(params: {
  username: string;
  amount: number;
  name?: string;
  broadcasterUserId?: number;
}): Promise<void> {
  if (!params.username) return;
  noteDonation(params.username, params.amount ? `${params.amount} kicks` : undefined, params.amount);
  if (!thanksOnce(`kicks:${params.username.toLowerCase()}:${params.amount}`)) return;
  const gift = params.name ? ` (${params.name})` : "";
  await say(
    `@${params.username} thanks for the ${params.amount} Kicks${gift}!`,
    undefined,
    params.broadcasterUserId,
  );
}

export async function handleDonation(params: {
  username: string;
  amount?: string;
  broadcasterUserId?: number;
}): Promise<void> {
  if (!params.username) return;
  noteDonation(params.username, params.amount);
  if (!thanksOnce(`donate:${params.username.toLowerCase()}`)) return;
  const extra = params.amount ? ` (${params.amount})` : "";
  await say(`@${params.username} thanks for the donation${extra}!`, undefined, params.broadcasterUserId);
}

export async function handleRewardRedemption(params: {
  username: string;
  title: string;
  input?: string;
  status: string;
}): Promise<void> {
  if (params.status !== "pending" && params.status !== "accepted") return;
  const extra = params.input ? ` — ${params.input}` : "";
  await say(`@${params.username} redeemed ${params.title}${extra}`);
}

export async function rememberBotIdentity(): Promise<void> {
  try {
    botUser = await getMe();
    console.log(`[bot] logged in as ${botUser.name} (${botUser.user_id})`);
    void yenimahalleWeather();
    warmupDota();
  } catch (err) {
    console.warn("[bot] could not load Kick user yet", err);
  }
}

function stripEmotes(content: string): string {
  return content.replace(/\[emote:\d+:[^\]]+\]/g, "").replace(/\s+/g, " ").trim();
}

function selfAskReply(content: string, lang: "tr" | "en" | "other"): string | null {
  const t = content.toLowerCase();
  if (/ben kimim|kimim ben|who am i/i.test(t)) {
    return lang === "en"
      ? "You're mcvckaharamamm. This is your chat."
      : "Sen mcvckaharamamm'sin. Burası senin sohbetin.";
  }
  if (/öldün( mü| mu)?|oldun mu|orada m[ıi]s[ıi]n|you (there|dead|alive)|still (there|alive)/i.test(t)) {
    return lang === "en" ? "Yeah, I'm here." : "Buradayım.";
  }
  return null;
}

function isReplyToUs(chat: IncomingChat): boolean {
  if (chat.replyToId && wasBotMessage(chat.replyToId)) return true;
  if (isOwnBotName(chat.replyToName)) return true;
  if (wasBotText(chat.replyToContent)) return true;
  return false;
}

function alreadyHandledChat(chat: IncomingChat): boolean {
  const who = (chat.sender.username || chat.sender.channel_slug || "").toLowerCase();
  const norm = (chat.content || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  const keys = [
    chat.messageId ? `id:${chat.messageId}` : "",
    chat.sender.user_id && norm ? `uid:${chat.sender.user_id}:${norm}` : "",
    who && norm ? `txt:${who}:${norm}` : "",
  ].filter(Boolean);
  if (keys.some((k) => handledChat.has(k))) return true;
  for (const key of keys) {
    handledChat.add(key);
    setTimeout(() => handledChat.delete(key), 60_000);
  }
  return false;
}

const welcomeBurst = { at: 0, n: 0 };

async function maybeWelcome(chat: IncomingChat, verifiedFirst = false): Promise<void> {
  if (chat.sender.user_id <= 0) return;
  if (isTheKing(chat.sender) || isStaff(chat.sender, chat.broadcaster)) {
    markChat(chat.sender.user_id, chat.sender.username);
    return;
  }
  const { brandNew, firstToday } = markChat(chat.sender.user_id, chat.sender.username);
  if (!brandNew && !firstToday && !verifiedFirst) return;
  if (Date.now() - welcomeBurst.at > 60_000) {
    welcomeBurst.at = Date.now();
    welcomeBurst.n = 0;
  }
  welcomeBurst.n += 1;
  if (welcomeBurst.n > 4) return;
  const who = chat.sender.username;
  if (verifiedFirst) {
    await say(
      `@${who} welcome. Honor to have a verified streamer in the king's chat.`,
      undefined,
      chat.broadcaster.user_id,
    );
    return;
  }
  if (!brandNew && !firstToday) return;
  const line = brandNew
    ? pick([
        `@${who} first time in camel lands? Welcome. Try not to embarrass yourself.`,
        `Hoş geldin @${who}. New here, so I'll be nice... for now.`,
        `@${who} a fresh one. Welcome to the stream, don't make me regret this.`,
      ])
    : pick([
        `@${who} look who crawled back. Welcome to the stream I guess.`,
        `Günaydın şampiyon @${who}. You again. Fine, welcome.`,
        `@${who} first message today. The king of chat noticed. Behave.`,
      ]);
  await say(line, undefined, chat.broadcaster.user_id);
}

function pick(lines: string[]): string {
  return lines[Math.floor(Math.random() * lines.length)] ?? lines[0]!;
}

async function maybeThankDonationAlert(chat: IncomingChat): Promise<void> {
  const name = (chat.sender.username || "").toLowerCase();
  if (!["streamlabs", "streamelements", "own3d"].includes(name)) return;
  const match = chat.content.match(
    /^@?([A-Za-z0-9_]+)\s+(?:donated|tipped|bağışladı|bagisladi)\s+(\$?[\d.,]+(?:\s*[A-Za-z]{2,4})?)/i,
  );
  if (!match?.[1]) return;
  await handleDonation({
    username: match[1],
    amount: match[2],
    broadcasterUserId: chat.broadcaster.user_id,
  });
}

function parseRaidAnnouncement(
  content: string,
  fallback?: string,
): { username: string; viewers?: number } | null {
  const t = content.replace(/\[emote:[^\]]+\]/g, " ").replace(/\s+/g, " ").trim();
  if (!/\braid(?:ing|ed|s)?\b/i.test(t) && !/\bbask[iı]n\b/i.test(t)) return null;
  if (/\b(void|shadow|nyx|boss) raid\b/i.test(t)) return null;
  if (/\bthanks for the raid\b/i.test(t) || /\braid için teşekkür/i.test(t)) return null;
  const named = t.match(
    /@?([A-Za-z0-9_]{3,25})\s+(?:is )?(?:raid(?:ing|ed)|hosting)(?:\s+(?:in|with|with a))?\s+(\d{1,6})/i,
  );
  if (named?.[1]) return { username: named[1], viewers: Number(named[2]) };
  const viewers = t.match(/(\d{1,6})\s*(?:viewers?|izleyic(?:i|iler)|ki[sş]i)/i);
  const tagged = t.match(/@([A-Za-z0-9_]{3,25})/);
  if (viewers && (tagged?.[1] || fallback)) {
    return { username: tagged?.[1] || fallback!, viewers: Number(viewers[1]) };
  }
  return null;
}

async function maybeThankRaid(chat: IncomingChat): Promise<boolean> {
  const raid = parseRaidAnnouncement(chat.content, chat.sender.username);
  if (!raid) return false;
  await handleRaid({
    username: raid.username,
    viewers: raid.viewers,
    broadcasterUserId: chat.broadcaster.user_id,
  });
  return true;
}

export { say };
