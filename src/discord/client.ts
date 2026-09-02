import { ChannelType, Client, Events, GatewayIntentBits, Partials, type Message } from "discord.js";
import { noteExchange, rememberPerson } from "../bot/memory.js";
import { calledTheBot, calledTheMods, replyWithAi, shouldTalkToAi } from "../bot/ai.js";
import { detectLang } from "../bot/lang.js";
import { config } from "../config.js";
import {
  discordDisplayName,
  discordKingUserId,
  discordUserKey,
  ensureDiscordMemory,
  isDiscordKing,
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

let client: Client | undefined;
let starting = false;
let guildOptions: Array<{ id: string; name: string }> = [];
let channelOptionsByGuild = new Map<string, Array<{ id: string; name: string }>>();
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

export type DiscordStatus = {
  configured: boolean;
  ready: boolean;
  tag: string | null;
  routes: DiscordRouteStatus[];
  alwaysReplyUserIds: string[];
  kingUserId: string;
  messagesSeen: number;
  repliesSent: number;
  lastMessageAt: string | null;
  lastReplyAt: string | null;
  lastError: string | null;
  guildOptions: Array<{ id: string; name: string }>;
  channelsByGuild: Record<string, Array<{ id: string; name: string }>>;
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

function noteError(err: unknown): void {
  lastError = err instanceof Error ? err.message : String(err);
  console.warn("[discord]", lastError);
}

function routing(): DiscordRouting {
  return getDiscordRouting();
}

async function refreshDiscordOptions(): Promise<void> {
  if (!client?.isReady()) {
    guildOptions = [];
    channelOptionsByGuild = new Map();
    return;
  }
  guildOptions = [...client.guilds.cache.values()]
    .map((g) => ({ id: g.id, name: g.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  channelOptionsByGuild = new Map();
  for (const guild of client.guilds.cache.values()) {
    try {
      const fetched = await guild.channels.fetch();
      const rows = [...fetched.values()]
        .filter((ch) => ch && ch.isTextBased() && !ch.isThread())
        .map((ch) => ({
          id: ch!.id,
          name: ch!.type === ChannelType.GuildCategory ? ch!.name : `#${ch!.name}`,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      channelOptionsByGuild.set(guild.id, rows);
    } catch (err) {
      noteError(err);
    }
  }
}

async function channelLabel(channelId: string, guildId: string): Promise<string | null> {
  if (!client?.isReady() || !channelId) return null;
  const channel = await client.channels.fetch(channelId);
  if (!channel || !("guild" in channel) || channel.guild?.id !== guildId) return null;
  return "name" in channel ? (channel.name ?? null) : null;
}

async function guildLabel(guildId: string): Promise<string | null> {
  if (!client?.isReady() || !guildId) return null;
  try {
    return (await client.guilds.fetch(guildId)).name;
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
  if (!next.routes.length) return "Add at least one server listen/post route.";
  if (!client?.isReady()) return null;
  try {
    for (const route of next.routes) {
      if (!route.guildId || !route.listenChannelId) {
        return "Each route needs a server and listen channel.";
      }
      const listenBad = await assertChannelInGuild(route.guildId, route.listenChannelId, "Listen channel");
      if (listenBad) return listenBad;
      const postId = routePostChannelId(route);
      if (postId !== route.listenChannelId) {
        const postBad = await assertChannelInGuild(route.guildId, postId, "Post channel");
        if (postBad) return postBad;
      }
    }
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "Could not verify routes.";
  }
}

async function deliverReply(message: Message, route: DiscordChannelRoute, line: string): Promise<void> {
  const targetId = routePostChannelId(route);
  const text = clipDiscord(formatForDiscord(line));

  if (targetId === message.channelId) {
    await message.reply({ content: text, allowedMentions: { repliedUser: true } });
    return;
  }

  const target = await client!.channels.fetch(targetId);
  if (!target?.isSendable()) throw new Error("Post channel is not a text channel.");
  await target.send({ content: text });
}

async function handleMessage(message: Message): Promise<void> {
  const configRoute = findRouteForMessage(routing(), message.guildId, message.channelId);
  if (!configRoute) return;
  if (message.author.bot) return;

  const content = message.content.trim();
  if (!content) return;

  const userId = message.author.id;
  const always = alwaysReplyUserIds(routing()).includes(userId);
  const pinged = mentionedBot(message);
  const parentWasBot = isReplyToBot(message);
  if (!always && !pinged && !parentWasBot) return;

  ensureDiscordMemory(userId);
  const who = discordDisplayName(userId, message.author.username);
  const userKey = discordUserKey(userId);
  const fromKing = isDiscordKing(userId, message.author.username, message.member?.displayName ?? message.author.globalName);

  messagesSeen += 1;
  lastMessageAt = Date.now();
  console.log(`[discord] message from ${who}: ${content.slice(0, 80)}`);

  const lang = detectLang(content, userKey);

  try {
    const reply = await replyWithAi(
      {
        sender: { user_id: userKey, username: who },
        content,
      },
      {
        force: always || pinged || parentWasBot,
        parentWasBot,
        lang,
        fromKing,
        allowKing: fromKing,
        calledBot: calledTheBot(content) && !fromKing,
        calledMods: calledTheMods(content),
      },
    );

    const line =
      reply ||
      (lang === "en" ? "Say that again — AI glitched for a second." : "Bir daha yaz, AI anlık takıldı.");

    await deliverReply(message, configRoute, line);
    rememberPerson({ user_id: userKey, username: who }, content);
    noteExchange(userKey, who, content, line);
    repliesSent += 1;
    lastReplyAt = Date.now();
    lastError = null;
    const postId = routePostChannelId(configRoute);
    console.log(
      `[discord] replied to ${who}${postId !== configRoute.listenChannelId ? ` (posted in ${postId})` : ""}`,
    );
  } catch (err) {
    noteError(err);
    try {
      const fail =
        lang === "en" ? "Couldn't send a reply (check bot permissions)." : "Cevap gönderemedim (bot izinlerine bak).";
      await deliverReply(message, configRoute, fail).catch(() => message.reply({ content: fail }));
    } catch (sendErr) {
      noteError(sendErr);
    }
  }
}

export function discordReady(): boolean {
  return Boolean(client?.isReady());
}

export async function discordStatus(): Promise<DiscordStatus> {
  const routes = routing();
  const routeRows = await Promise.all(routes.routes.map((r) => buildRouteStatus(r)));
  const channelsByGuild: Record<string, Array<{ id: string; name: string }>> = {};
  for (const [gid, rows] of channelOptionsByGuild.entries()) {
    channelsByGuild[gid] = rows;
  }
  return {
    configured: config.discord.enabled && Boolean(config.discord.token),
    ready: discordReady(),
    tag: client?.user?.tag ?? null,
    routes: routeRows,
    alwaysReplyUserIds: alwaysReplyUserIds(routes),
    kingUserId: discordKingUserId(),
    messagesSeen,
    repliesSent,
    lastMessageAt: lastMessageAt ? new Date(lastMessageAt).toISOString() : null,
    lastReplyAt: lastReplyAt ? new Date(lastReplyAt).toISOString() : null,
    lastError,
    guildOptions: [...guildOptions],
    channelsByGuild,
  };
}

export async function applyDiscordRouting(next: DiscordRouting): Promise<void> {
  const bad = await validateDiscordRouting(next);
  if (bad) throw new Error(bad);
  saveDiscordRouting(next);
  reloadDiscordRoutingCache();
  await reloadDiscord();
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
  const routes = routing();
  if (!routes.routes.length) {
    console.warn("[discord] add listen/post routes on Dashboard → Discord");
    return;
  }

  starting = true;
  try {
    client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
      partials: [Partials.Channel],
    });

    client.once(Events.ClientReady, (c) => {
      void (async () => {
        seedAllDiscordIdentities();
        console.log(`[discord] logged in as ${c.user.tag}`);
        await refreshDiscordOptions();
        for (const route of routes.routes) {
          const row = await buildRouteStatus(route);
          const postNote =
            route.postChannelId && route.postChannelId !== route.listenChannelId
              ? ` → post #${row.postName ?? routePostChannelId(route)}`
              : "";
          console.log(
            `[discord] route: ${row.guildName ?? route.guildId} listen #${row.listenName ?? route.listenChannelId}${postNote}`,
          );
        }
        if (routes.alwaysReplyUsers.length) {
          console.log(`[discord] always reply: ${alwaysReplyUserIds(routes).join(", ")}`);
        }
      })().catch((err) => noteError(err));
    });

    client.on(Events.MessageCreate, (message) => {
      void handleMessage(message).catch((err) => noteError(err));
    });

    await client.login(config.discord.token);
  } catch (err) {
    noteError(err);
    client = undefined;
  } finally {
    starting = false;
  }
}
