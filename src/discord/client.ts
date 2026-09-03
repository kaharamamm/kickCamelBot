import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits,
  type Guild,
  type Message,
} from "discord.js";
import { noteExchange, rememberPerson } from "../bot/memory.js";
import { botFail, botOk, botThink } from "../bot/activityLog.js";
import {
  asksAboutStreamer,
  busyFallback,
  calledTheBot,
  calledTheMods,
  rememberExchange,
  replyWithAi,
  shouldTalkToAi,
} from "../bot/ai.js";
import { detectLang } from "../bot/lang.js";
import { enqueueWork } from "../bot/workQueue.js";
import { config } from "../config.js";
import { runKingOrder, shouldTryKingOrder } from "../bot/kingOrder.js";
import { getMyChannel } from "../kick/api.js";
import {
  discordDisplayName,
  discordKingUserId,
  discordUserKey,
  ensureDiscordMemory,
  isDiscordKing,
  replyUserLabel,
  seedAllDiscordIdentities,
} from "./identities.js";
import {
  alwaysReplyUserIds,
  findRouteForMessage,
  getDiscordRouting,
  reloadDiscordRoutingCache,
  routePostChannelId,
  saveDiscordRouting,
  type DiscordChannelRoute,
  type DiscordRouting,
} from "./settings.js";
import { rememberThread, stillTalkingToUs } from "../bot/conversation.js";
import { listTtsVoices } from "./voicePrefs.js";
import { handleVoiceCommand, isShutUpRequest, parseSpeakDirective, speakInGuild, stopSpeaking, tryBotSelfListenControl, voiceStatus } from "./voice.js";
import { tryDiscordVoiceOrder } from "./voiceOrder.js";
import { tryDiscordStaffOrder } from "./staff.js";
import { getLastBotLine, rememberBotText } from "./speechMemory.js";

let client: Client | undefined;
let starting = false;
let guildOptions: Array<{ id: string; name: string }> = [];
let channelOptionsByGuild = new Map<string, Array<{ id: string; name: string }>>();
let voiceChannelOptionsByGuild = new Map<string, Array<{ id: string; name: string }>>();
let messagesSeen = 0;
let repliesSent = 0;
let lastMessageAt: number | null = null;
let lastReplyAt: number | null = null;
let lastError: string | null = null;

export type DiscordRouteStatus = {
  guildId: string;
  listenChannelId: string;
  postChannelId: string;
  guildName: string | null;
  listenName: string | null;
  postName: string | null;
};

export type DiscordAlwaysReplyStatus = {
  id: string;
  label: string;
  displayName: string;
};

export type DiscordStatus = {
  configured: boolean;
  ready: boolean;
  tag: string | null;
  routes: DiscordRouteStatus[];
  alwaysReplyUsers: DiscordAlwaysReplyStatus[];
  alwaysReplyUserIds: string[];
  kingUserId: string;
  messagesSeen: number;
  repliesSent: number;
  lastMessageAt: string | null;
  lastReplyAt: string | null;
  lastError: string | null;
  guildOptions: Array<{ id: string; name: string }>;
  channelsByGuild: Record<string, Array<{ id: string; name: string }>>;
  voiceChannelsByGuild: Record<string, Array<{ id: string; name: string }>>;
  voice: {
    stt: boolean;
    tts: boolean;
    sttProvider: string;
    ttsProvider: string;
    voiceId: string;
    model: string;
    voices: Array<{ id: string; label: string; provider?: string }>;
    sessions: Array<{ guildId: string; voiceChannelId: string; textChannelId: string }>;
  };
};

function clipDiscord(text: string, max = 1900): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function formatForDiscord(text: string): string {
  return text.replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, "\\*$1\\*");
}

function mentionedBot(message: Message): boolean {
  const botId = message.client.user?.id;
  if (botId && message.mentions.users.has(botId)) return true;
  const botName = message.client.user?.username?.toLowerCase() ?? "";
  const text = message.content.toLowerCase();
  if (botName && text.includes(`@${botName}`)) return true;
  return shouldTalkToAi(message.content) || calledTheBot(message.content) || calledTheMods(message.content);
}

function isReplyToBot(message: Message): boolean {
  return message.mentions.repliedUser?.id === message.client.user?.id;
}

function isMissingAccess(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /missing access|50001|missing permissions/i.test(msg);
}

function noteError(err: unknown): void {
  if (isMissingAccess(err)) {
    console.warn("[discord] skipped a channel/user the bot cannot see");
    return;
  }
  lastError = err instanceof Error ? err.message : String(err);
  botFail("discord", lastError);
  console.warn("[discord]", lastError);
}

function routing(): DiscordRouting {
  return getDiscordRouting();
}

function textChannelsBotCanSee(guild: Guild): Array<{ id: string; name: string }> {
  const me = guild.members.me;
  const rows: Array<{ id: string; name: string }> = [];
  for (const ch of guild.channels.cache.values()) {
    if (!ch || !ch.isTextBased() || ch.isThread()) continue;
    if (me) {
      const perms = ch.permissionsFor(me);
      if (!perms?.has(PermissionFlagsBits.ViewChannel)) continue;
    }
    rows.push({ id: ch.id, name: `#${ch.name}` });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

function voiceChannelsBotCanSee(guild: Guild): Array<{ id: string; name: string }> {
  const me = guild.members.me;
  const rows: Array<{ id: string; name: string }> = [];
  for (const ch of guild.channels.cache.values()) {
    if (!ch || (ch.type !== ChannelType.GuildVoice && ch.type !== ChannelType.GuildStageVoice)) continue;
    if (me) {
      const perms = ch.permissionsFor(me);
      if (!perms?.has(PermissionFlagsBits.ViewChannel) || !perms?.has(PermissionFlagsBits.Connect)) continue;
    }
    rows.push({ id: ch.id, name: ch.name });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

async function refreshDiscordOptions(): Promise<void> {
  if (!client?.isReady()) {
    guildOptions = [];
    channelOptionsByGuild = new Map();
    voiceChannelOptionsByGuild = new Map();
    return;
  }
  try {
    await client.guilds.fetch();
  } catch (err) {
    console.warn("[discord] guild list fetch:", err instanceof Error ? err.message : err);
  }

  guildOptions = [...client.guilds.cache.values()]
    .map((g) => ({ id: g.id, name: g.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  channelOptionsByGuild = new Map();
  voiceChannelOptionsByGuild = new Map();
  for (const guild of client.guilds.cache.values()) {
    try {
      await guild.channels.fetch().catch(() => guild.channels.cache);
      await guild.members.fetchMe().catch(() => undefined);
      channelOptionsByGuild.set(guild.id, textChannelsBotCanSee(guild));
      voiceChannelOptionsByGuild.set(guild.id, voiceChannelsBotCanSee(guild));
    } catch (err) {
      if (!isMissingAccess(err)) noteError(err);
      channelOptionsByGuild.set(guild.id, textChannelsBotCanSee(guild));
      voiceChannelOptionsByGuild.set(guild.id, voiceChannelsBotCanSee(guild));
    }
  }
}

async function channelLabel(channelId: string, guildId: string): Promise<string | null> {
  if (!client?.isReady() || !channelId) return null;
  try {
    const cached = client.channels.cache.get(channelId);
    const channel = cached ?? (await client.channels.fetch(channelId));
    if (!channel || !("guild" in channel) || channel.guild?.id !== guildId) return null;
    return "name" in channel ? (channel.name ?? null) : null;
  } catch (err) {
    if (!isMissingAccess(err)) noteError(err);
    return null;
  }
}

async function guildLabel(guildId: string): Promise<string | null> {
  if (!client?.isReady() || !guildId) return null;
  try {
    const cached = client.guilds.cache.get(guildId);
    return (cached ?? (await client.guilds.fetch(guildId))).name;
  } catch {
    return null;
  }
}

async function buildRouteStatus(route: DiscordChannelRoute): Promise<DiscordRouteStatus> {
  const postId = routePostChannelId(route);
  return {
    guildId: route.guildId,
    listenChannelId: route.listenChannelId,
    postChannelId: postId,
    guildName: await guildLabel(route.guildId),
    listenName: await channelLabel(route.listenChannelId, route.guildId),
    postName: await channelLabel(postId, route.guildId),
  };
}

/** Prefer server nickname, then global display name, then username. */
export async function resolveDiscordDisplayName(userId: string, preferredGuildId?: string): Promise<string> {
  if (!client?.isReady() || !userId) return "";

  const guildIds = [
    ...(preferredGuildId ? [preferredGuildId] : []),
    ...routing().routes.map((r) => r.guildId),
    ...client.guilds.cache.keys(),
  ];
  const seen = new Set<string>();
  for (const guildId of guildIds) {
    if (!guildId || seen.has(guildId)) continue;
    seen.add(guildId);
    try {
      const guild = client.guilds.cache.get(guildId) ?? (await client.guilds.fetch(guildId));
      const member = guild.members.cache.get(userId) ?? (await guild.members.fetch(userId));
      const nick = member.nickname?.trim() || member.displayName?.trim();
      if (nick) return nick;
      const uname = member.user.globalName?.trim() || member.user.username;
      if (uname) return uname;
    } catch {
      /* try next guild / users.fetch */
    }
  }

  try {
    const user = await client.users.fetch(userId);
    return user.globalName?.trim() || user.username || "";
  } catch {
    return "";
  }
}

async function enrichAlwaysReplyLabels(): Promise<void> {
  const current = routing();
  if (!current.alwaysReplyUsers.length || !client?.isReady()) return;

  let changed = false;
  const next = [];
  for (const u of current.alwaysReplyUsers) {
    if (u.label.trim()) {
      next.push(u);
      continue;
    }
    const known = replyUserLabel(u.id);
    if (known) {
      next.push({ id: u.id, label: known });
      changed = true;
      continue;
    }
    const resolved = await resolveDiscordDisplayName(u.id);
    if (resolved) {
      next.push({ id: u.id, label: resolved });
      changed = true;
    } else {
      next.push(u);
    }
  }

  if (changed) {
    saveDiscordRouting({ alwaysReplyUsers: next });
    reloadDiscordRoutingCache();
  }
}

async function assertChannelInGuild(guildId: string, channelId: string, label: string): Promise<string | null> {
  const guild = await client!.guilds.fetch(guildId);
  const channel = await client!.channels.fetch(channelId);
  if (!channel || !("guild" in channel) || channel.guild?.id !== guildId) {
    return `${label} ${channelId} is not in server "${guild.name}".`;
  }
  if (!channel.isTextBased()) return `${label} must be a text channel.`;
  return null;
}

export async function validateDiscordRouting(next: DiscordRouting): Promise<string | null> {
  // Empty routes is valid — Discord listening stays off until you add one back.
  for (const route of next.routes) {
    if (!route.guildId || !route.listenChannelId) {
      return "Each route needs a server and listen channel.";
    }
  }
  if (!next.routes.length || !client?.isReady()) return null;
  try {
    for (const route of next.routes) {
      const listenBad = await assertChannelInGuild(route.guildId, route.listenChannelId, "Listen channel");
      if (listenBad) {
        console.warn(`[discord] ${listenBad} (saved anyway)`);
        continue;
      }
      const postId = routePostChannelId(route);
      if (postId !== route.listenChannelId) {
        const postBad = await assertChannelInGuild(route.guildId, postId, "Post channel");
        if (postBad) console.warn(`[discord] ${postBad} (saved anyway)`);
      }
    }
    return null;
  } catch (err) {
    console.warn("[discord] route check soft-fail:", err instanceof Error ? err.message : err);
    return null;
  }
}

async function deliverReply(message: Message, route: DiscordChannelRoute, line: string): Promise<void> {
  const targetId = routePostChannelId(route);
  await enqueueWork(`discord-send:${targetId}`, async () => {
    const text = clipDiscord(formatForDiscord(line));

    if (targetId === message.channelId) {
      await message.reply({ content: text, allowedMentions: { repliedUser: true } });
      return;
    }

    const target = await client!.channels.fetch(targetId);
    if (!target?.isSendable()) throw new Error("Post channel is not a text channel.");
    await target.send({ content: text });
  });
}

async function handleMessage(message: Message): Promise<void> {
  if (message.author.bot) return;

  const content = message.content.trim();
  if (!content) return;

  const userId = message.author.id;
  const fromKingEarly = isDiscordKing(
    userId,
    message.author.username,
    message.member?.displayName ?? message.author.globalName,
  );
  const always = alwaysReplyUserIds(routing()).includes(userId);
  const configRoute = findRouteForMessage(routing(), message.guildId, message.channelId);

  if (/^!voice\b/i.test(content)) {
    if (!configRoute && !always) return;
    await handleVoiceCommand(message);
    return;
  }

  // Silent interrupt from chat while TTS is playing (or just after) — never reply
  if (message.guildId && isShutUpRequest(content) && (always || configRoute)) {
    stopSpeaking(message.guildId);
    return;
  }

  // Mute/unmute the bot itself (stop/start listening in VC) — silent
  if (message.guildId && (always || configRoute || calledTheBot(content) || shouldTalkToAi(content))) {
    const selfCtrl = tryBotSelfListenControl(message.guildId, content);
    if (selfCtrl.handled) {
      rememberThread(message.guildId, userId);
      return;
    }
  }

  if (!configRoute) return;

  const pinged = mentionedBot(message);
  const parentWasBot = isReplyToBot(message);
  const roomId = message.guildId ?? message.channelId;
  const continuing = stillTalkingToUs(roomId, userId, content, message.mentions.repliedUser?.username, parentWasBot);
  if (!always && !pinged && !parentWasBot && !continuing) return;

  ensureDiscordMemory(userId);
  const liveName =
    message.member?.displayName?.trim() ||
    message.author.globalName?.trim() ||
    message.author.username;
  const savedLabel = routing().alwaysReplyUsers.find((u) => u.id === userId)?.label?.trim() ?? "";
  const who = discordDisplayName(userId, savedLabel || liveName);
  const userKey = discordUserKey(userId);
  const fromKing = fromKingEarly;

  messagesSeen += 1;
  lastMessageAt = Date.now();
  botThink("discord", `${who}: ${content.slice(0, 100)}`);
  console.log(`[discord] message from ${who}: ${content.slice(0, 80)}`);

  const lang = detectLang(content, userKey);
  const speakDir = parseSpeakDirective(content);
  const wantVoice = speakDir.wantsSpeak;

  try {
    // Discord staff: move / mute / kick / timeout — if the bot (and requester) have the perms.
    const staff = await tryDiscordStaffOrder(message, { lang, fromKing });
    if (staff.handled) {
      if (staff.text) await deliverReply(message, configRoute, staff.text);
      rememberPerson({ user_id: userKey, username: who }, content);
      noteExchange(userKey, who, content, staff.text || "ok");
      rememberThread(roomId, userId);
      repliesSent += 1;
      lastReplyAt = Date.now();
      lastError = staff.ok ? null : staff.text || null;
      if (staff.ok) botOk("discord", `Staff order for ${who}`);
      else if (staff.text) botFail("discord", staff.text);
      return;
    }

    // Natural-language Discord voice orders: "bu kanala katıl ve bana kralım de"
    const voiceOrder = await tryDiscordVoiceOrder(message, {
      lang,
      userKey,
      who,
      fromKing,
    });
    if (voiceOrder.handled) {
      if (voiceOrder.error) {
        await deliverReply(
          message,
          configRoute,
          lang === "en" ? voiceOrder.error : voiceOrder.error,
        );
      }
      // Success: join/leave/speak with no chat spam (same as sesli replies).
      rememberPerson({ user_id: userKey, username: who }, content);
      noteExchange(
        userKey,
        who,
        content,
        voiceOrder.error
          ? voiceOrder.error
          : [
              voiceOrder.joined ? "joined" : "",
              voiceOrder.left ? "left" : "",
              voiceOrder.spoke ? "spoke" : "",
            ]
              .filter(Boolean)
              .join("+") || "ok",
      );
      rememberThread(roomId, userId);
      repliesSent += 1;
      lastReplyAt = Date.now();
      lastError = voiceOrder.error ?? null;
      if (!voiceOrder.error) botOk("discord", `Voice order for ${who}`);
      return;
    }

    // King: Kick stream/mod orders from Discord ("change the title", "ban X", …)
    if (fromKing) {
      const tryKick = shouldTryKingOrder({
        content,
        addressed: pinged || always,
        continuing,
      });
      if (tryKick) {
        try {
          let broadcasterId = 549839;
          try {
            broadcasterId = (await getMyChannel()).broadcaster_user_id;
          } catch {
            /* keep default */
          }
          const kickResult = await runKingOrder(content, lang, broadcasterId);
          if (kickResult !== undefined) {
            if (kickResult) await deliverReply(message, configRoute, kickResult);
            rememberPerson({ user_id: userKey, username: who }, content);
            noteExchange(userKey, who, content, kickResult || "ok");
            rememberThread(roomId, userId);
            repliesSent += 1;
            lastReplyAt = Date.now();
            lastError = null;
            botOk("discord", `Kick order from Discord for ${who}`);
            return;
          }
        } catch (err) {
          botFail("discord", `Kick order fail: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    // Direct “say this: … in tr ahmet” — speak the quote, no AI, no text if TTS works.
    if (wantVoice && speakDir.directSay && speakDir.phrase) {
      const guildId = message.guildId;
      const speakLang = speakDir.lang ?? detectLang(speakDir.phrase, userKey);
      if (!guildId) {
        await deliverReply(
          message,
          configRoute,
          lang === "en"
            ? "Join a voice channel and `!voice join` first, then ask me to say it."
            : "Önce ses kanalına girip `!voice join` yap, sonra sesli söylememi iste.",
        );
      } else {
        const spoken = await speakInGuild(guildId, speakDir.phrase, {
          lang: speakLang,
          voice: speakDir.voice,
          forceVoice: speakDir.forceVoice,
          userKey,
        });
        if (!spoken.ok) {
          await deliverReply(
            message,
            configRoute,
            lang === "en"
              ? `Couldn't speak: ${spoken.error}`
              : `Sesli söyleyemedim: ${spoken.error}`,
          );
        } else {
          botOk("discord", `Spoke phrase for ${who}`);
          rememberExchange(userKey, content, `[voice] ${speakDir.phrase}`);
        }
      }
      rememberPerson({ user_id: userKey, username: who }, content);
      noteExchange(userKey, who, content, speakDir.phrase);
      rememberThread(roomId, userId);
      repliesSent += 1;
      lastReplyAt = Date.now();
      lastError = null;
      return;
    }

    const reply = await replyWithAi(
      {
        sender: { user_id: userKey, username: who },
        content,
      },
      {
        force: always || pinged || parentWasBot || continuing,
        continuing: true,
        parentWasBot,
        lang,
        fromKing,
        allowKing: fromKing || asksAboutStreamer(content),
        calledBot: calledTheBot(content) && !fromKing,
        calledMods: calledTheMods(content),
        voiceReply: wantVoice,
        lastSpoken: getLastBotLine(message.guildId ?? undefined, userKey),
      },
    );

    const line = reply || busyFallback(lang);

    if (wantVoice) {
      const guildId = message.guildId;
      const speakLang = speakDir.lang ?? detectLang(line, userKey);
      const speakText = speakDir.phrase && /["“”'‘’]/.test(content) ? speakDir.phrase : line;
      if (guildId) {
        const spoken = await speakInGuild(guildId, speakText, {
          lang: speakLang,
          voice: speakDir.voice,
          forceVoice: speakDir.forceVoice,
          userKey,
        });
        if (spoken.ok) {
          botOk("discord", `Spoke reply for ${who}`);
          rememberPerson({ user_id: userKey, username: who }, content);
          noteExchange(userKey, who, content, speakText);
          rememberExchange(userKey, content, `[voice] ${speakText}`);
          rememberThread(roomId, userId);
          repliesSent += 1;
          lastReplyAt = Date.now();
          lastError = null;
          console.log(`[discord] spoke to ${who} (no text)`);
          return;
        }
        await deliverReply(
          message,
          configRoute,
          lang === "en"
            ? `${line}\n_(Couldn't speak: ${spoken.error})_`
            : `${line}\n_(Sesli söyleyemedim: ${spoken.error})_`,
        );
      } else {
        await deliverReply(
          message,
          configRoute,
          lang === "en"
            ? `${line}\n_(Voice replies need a server channel — join voice and !voice join.)_`
            : `${line}\n_(Sesli cevap için sunucuda ses kanalına girip !voice join lazım.)_`,
        );
      }
    } else {
      await deliverReply(message, configRoute, line);
      rememberBotText(userKey, line, message.guildId ?? undefined);
    }

    rememberPerson({ user_id: userKey, username: who }, content);
    noteExchange(userKey, who, content, line);
    rememberThread(roomId, userId);
    repliesSent += 1;
    lastReplyAt = Date.now();
    lastError = null;
    botOk("discord", `Replied to ${who}`);
    const postId = routePostChannelId(configRoute);
    console.log(
      `[discord] replied to ${who}${postId !== configRoute.listenChannelId ? ` (posted in ${postId})` : ""}${wantVoice ? " (voice fallback text)" : ""}`,
    );
  } catch (err) {
    noteError(err);
    try {
      const fail =
        lang === "en" ? "Couldn't send a reply (check bot permissions)." : "Cevap gönderemedim (bot izinlerine bak).";
      await deliverReply(message, configRoute, fail).catch(() => message.reply({ content: fail }));
      rememberThread(roomId, userId);
    } catch (sendErr) {
      noteError(sendErr);
    }
  }
}

export function getDiscordClient(): Client | undefined {
  return client;
}

export function discordReady(): boolean {
  return Boolean(client?.isReady());
}

export async function discordStatus(): Promise<DiscordStatus> {
  if (client?.isReady() && !guildOptions.length) {
    await refreshDiscordOptions();
  }
  const routes = routing();
  const routeRows = await Promise.all(routes.routes.map((r) => buildRouteStatus(r)));
  const channelsByGuild: Record<string, Array<{ id: string; name: string }>> = {};
  for (const [gid, rows] of channelOptionsByGuild.entries()) {
    channelsByGuild[gid] = rows;
  }
  const voiceChannelsByGuild: Record<string, Array<{ id: string; name: string }>> = {};
  for (const [gid, rows] of voiceChannelOptionsByGuild.entries()) {
    voiceChannelsByGuild[gid] = rows;
  }

  const alwaysReplyUsers: DiscordAlwaysReplyStatus[] = [];
  for (const u of routes.alwaysReplyUsers) {
    const displayName =
      u.label.trim() ||
      replyUserLabel(u.id) ||
      (await resolveDiscordDisplayName(u.id, routes.routes[0]?.guildId)) ||
      "";
    alwaysReplyUsers.push({
      id: u.id,
      label: u.label,
      displayName: displayName || u.id,
    });
  }

  return {
    configured: config.discord.enabled && Boolean(config.discord.token),
    ready: discordReady(),
    tag: client?.user?.tag ?? null,
    routes: routeRows,
    alwaysReplyUsers,
    alwaysReplyUserIds: alwaysReplyUserIds(routes),
    kingUserId: discordKingUserId(),
    messagesSeen,
    repliesSent,
    lastMessageAt: lastMessageAt ? new Date(lastMessageAt).toISOString() : null,
    lastReplyAt: lastReplyAt ? new Date(lastReplyAt).toISOString() : null,
    lastError,
    guildOptions,
    channelsByGuild,
    voiceChannelsByGuild,
    voice: (() => {
      const v = voiceStatus();
      return {
        stt: v.configured.stt,
        tts: v.configured.tts,
        sttProvider: v.configured.sttProvider,
        ttsProvider: v.configured.ttsProvider,
        voiceId: v.prefs.voice,
        model: v.prefs.model,
        voices: listTtsVoices(),
        sessions: v.sessions,
      };
    })(),
  };
}

export async function applyDiscordRouting(next: DiscordRouting): Promise<void> {
  const bad = await validateDiscordRouting(next);
  if (bad) throw new Error(bad);
  saveDiscordRouting(next);
  reloadDiscordRoutingCache();
  if (!client?.isReady()) {
    await startDiscord();
    return;
  }
  await refreshDiscordOptions();
}

export async function reloadDiscord(): Promise<void> {
  if (client) {
    client.removeAllListeners();
    await client.destroy().catch(() => undefined);
    client = undefined;
    guildOptions = [];
    channelOptionsByGuild = new Map();
  }
  await startDiscord();
}

export async function startDiscord(): Promise<void> {
  if (!config.discord.enabled || !config.discord.token) return;
  if (starting) return;
  if (client?.isReady()) return;

  starting = true;
  try {
    if (client && !client.isReady()) {
      await client.destroy().catch(() => undefined);
      client = undefined;
    }
    client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.MessageContent,
      ],
      partials: [Partials.Channel],
    });
    attachDiscordListeners();
    await loginDiscord();
  } catch (err) {
    noteError(err);
    client = undefined;
  } finally {
    starting = false;
  }
}

function attachDiscordListeners(): void {
  if (!client) return;
  client.once(Events.ClientReady, (c) => {
    void (async () => {
      lastError = null;
      seedAllDiscordIdentities();
      console.log(`[discord] logged in as ${c.user.tag}`);
      await refreshDiscordOptions();
      await enrichAlwaysReplyLabels();
      const live = routing();
      if (!live.routes.length) {
        console.log("[discord] online — no listen routes yet; pick servers on Dashboard → Discord");
      }
      for (const route of live.routes) {
        const row = await buildRouteStatus(route);
        const postNote =
          route.postChannelId && route.postChannelId !== route.listenChannelId
            ? ` → post #${row.postName ?? routePostChannelId(route)}`
            : "";
        console.log(
          `[discord] route: ${row.guildName ?? route.guildId} listen #${row.listenName ?? route.listenChannelId}${postNote}`,
        );
      }
      if (live.alwaysReplyUsers.length) {
        const names = live.alwaysReplyUsers.map((u) => u.label || u.id).join(", ");
        console.log(`[discord] always reply: ${names}`);
      }
    })().catch((err) => noteError(err));
  });

  client.on(Events.GuildCreate, () => {
    void refreshDiscordOptions().catch((err) => noteError(err));
  });
  client.on(Events.GuildDelete, () => {
    void refreshDiscordOptions().catch((err) => noteError(err));
  });
  client.on(Events.ChannelCreate, () => {
    void refreshDiscordOptions().catch((err) => noteError(err));
  });
  client.on(Events.ChannelDelete, () => {
    void refreshDiscordOptions().catch((err) => noteError(err));
  });
  client.on(Events.MessageCreate, (message) => {
    void enqueueWork(`discord:${message.channelId}`, () => handleMessage(message)).catch((err) => noteError(err));
  });
}

async function loginDiscord(): Promise<void> {
  try {
    await client!.login(config.discord.token);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/intent/i.test(msg)) throw err;
    console.warn("[discord] privileged intent rejected — retrying without GuildMembers");
    await client!.destroy().catch(() => undefined);
    client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.MessageContent,
      ],
      partials: [Partials.Channel],
    });
    attachDiscordListeners();
    await client.login(config.discord.token);
  }
}
