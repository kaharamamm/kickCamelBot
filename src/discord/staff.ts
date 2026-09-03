import {
  ChannelType,
  PermissionFlagsBits,
  type Guild,
  type GuildMember,
  type Message,
  type VoiceBasedChannel,
} from "discord.js";
import { fold } from "../bot/slang.js";
import type { ChatLang } from "../bot/lang.js";
import { isDiscordKing } from "./identities.js";

export type DiscordStaffResult =
  | { handled: false }
  | { handled: true; ok: boolean; text: string };

type StaffKind =
  | "move"
  | "mute"
  | "unmute"
  | "deafen"
  | "undeafen"
  | "vckick"
  | "kick"
  | "ban"
  | "timeout";

type PendingMove = {
  scope: "me" | "us" | "user";
  joinBot: boolean;
  whoHint: string;
  at: number;
};

const PENDING_MS = 60_000;
const pendingMoves = new Map<string, PendingMove>();

const STAFF_HINT =
  /(?:\btasi\b|\btaşı\b|\btasin\b|\btaşın\b|\bmove\b|\bmute\b|\bunmute\b|\bsustur\b|\bdeafen\b|\bundeafen\b|\bsagir\b|\bsağır\b|\bkick\b|\bban\b|\btimeout\b|\bdisconnect\b|\bkopar\b|ses(?:ten|den)\s*at|kanaldan\s*at|sunucudan\s*at)/i;

export function shouldTryDiscordStaff(content: string): boolean {
  const t = content.replace(/\s+/g, " ").trim();
  if (!t || t.length > 400) return false;
  const f = fold(t);
  if (!STAFF_HINT.test(t) && !STAFF_HINT.test(f)) return false;
  return (
    /(?:beni|bizi|me\b|us\b|herkes|everyone|all\b|@)/.test(f) ||
    /(?:kanal|channel|ses|ust|alt|yukari|asagi|up|down)/.test(f) ||
    /(?:mute|unmute|sustur|kick|ban|timeout|deafen)/.test(f)
  );
}

export async function tryDiscordStaffOrder(
  message: Message,
  opts: { lang: ChatLang; fromKing: boolean },
): Promise<DiscordStaffResult> {
  if (!message.guild || !message.member) return { handled: false };
  return runStaff(message.guild, message.member, message.content, {
    lang: opts.lang,
    fromKing: opts.fromKing,
    mentionedUserIds: [...message.mentions.users.keys()].filter((id) => id !== message.client.user?.id),
    mentionedChannelIds: [...message.mentions.channels.keys()],
    textChannelId: message.channelId,
  });
}

export async function tryDiscordStaffFromVoice(
  guild: Guild,
  member: GuildMember,
  transcript: string,
  opts: { lang: ChatLang; fromKing: boolean; textChannelId?: string },
): Promise<DiscordStaffResult> {
  return runStaff(guild, member, transcript, {
    lang: opts.lang,
    fromKing: opts.fromKing,
    mentionedUserIds: [],
    mentionedChannelIds: [],
    textChannelId: opts.textChannelId,
  });
}

async function runStaff(
  guild: Guild,
  actor: GuildMember,
  content: string,
  ctx: {
    lang: ChatLang;
    fromKing: boolean;
    mentionedUserIds: string[];
    mentionedChannelIds: string[];
    textChannelId?: string;
  },
): Promise<DiscordStaffResult> {
  const key = pendingKey(guild.id, actor.id);
  const pending = takeFreshPending(key);
  let parsed = parseStaff(content);

  if (!parsed && pending) {
    parsed = { kind: "move", scope: pending.scope, whoHint: pending.whoHint, channelHint: content, joinBot: pending.joinBot };
  }
  if (!parsed) {
    const destOnly = await resolveVoiceChannel(guild, content, actor, ctx.mentionedChannelIds);
    if (destOnly && actor.voice.channel && destOnly.id !== actor.voice.channel.id && fold(content).length <= 48) {
      parsed = { kind: "move", scope: "me", whoHint: content, channelHint: content, joinBot: wantsJoin(content) };
    }
  }
  if (!parsed) return { handled: false };

  const bot = guild.members.me;
  if (!bot) return { handled: true, ok: false, text: "I'm not in this server." };

  const need = permFor(parsed.kind);
  if (!bot.permissions.has(need)) {
    return {
      handled: true,
      ok: false,
      text: `I don't have Discord permission: ${needName(need)}. Re-invite the bot with extra staff perms.`,
    };
  }

  const fromKing = ctx.fromKing || isDiscordKing(actor.id, actor.user.username, actor.displayName);
  if (!fromKing && !actor.permissions.has(need)) {
    return { handled: true, ok: false, text: "You don't have permission for that." };
  }

  try {
    if (parsed.kind === "move") {
      const dest = await resolveVoiceChannel(guild, parsed.channelHint || content, actor, ctx.mentionedChannelIds);
      if (!dest) {
        pendingMoves.set(key, {
          scope: parsed.scope,
          joinBot: parsed.joinBot,
          whoHint: parsed.whoHint,
          at: Date.now(),
        });
        return { handled: true, ok: false, text: "" };
      }
      pendingMoves.delete(key);
      if (!bot.permissionsIn(dest).has(PermissionFlagsBits.Connect | PermissionFlagsBits.MoveMembers)) {
        return { handled: true, ok: false, text: "" };
      }

      if (parsed.scope === "us") {
        const src = actor.voice.channel;
        if (!src || src.id === dest.id) {
          if (parsed.joinBot) await joinBotTo(guild, dest, ctx.textChannelId);
          return { handled: true, ok: true, text: "" };
        }
        const movers = [...src.members.values()].filter((m) => m.id !== bot.id);
        for (const m of movers) {
          await m.voice.setChannel(dest, "CamelBot staff order");
        }
        if (parsed.joinBot || src.members.has(bot.id)) {
          await joinBotTo(guild, dest, ctx.textChannelId);
        }
        return { handled: true, ok: true, text: "" };
      }

      const target =
        parsed.scope === "me"
          ? actor
          : await resolveMember(guild, parsed.whoHint, actor, ctx.mentionedUserIds);
      if (!target?.voice.channel) return { handled: true, ok: false, text: "" };
      if (target.voice.channel.id !== dest.id) {
        await target.voice.setChannel(dest, "CamelBot staff order");
      }
      if (parsed.joinBot) await joinBotTo(guild, dest, ctx.textChannelId);
      return { handled: true, ok: true, text: "" };
    }

    const target = await resolveMember(guild, parsed.whoHint, actor, ctx.mentionedUserIds);
    if (!target) return { handled: true, ok: false, text: "" };
    if (target.id === bot.id) return { handled: true, ok: false, text: "" };
    if (target.roles.highest.position >= bot.roles.highest.position && guild.ownerId !== bot.id) {
      return { handled: true, ok: false, text: "" };
    }

    switch (parsed.kind) {
      case "mute":
        await target.voice.setMute(true, "CamelBot staff order");
        return { handled: true, ok: true, text: "" };
      case "unmute":
        await target.voice.setMute(false, "CamelBot staff order");
        return { handled: true, ok: true, text: "" };
      case "deafen":
        await target.voice.setDeaf(true, "CamelBot staff order");
        return { handled: true, ok: true, text: "" };
      case "undeafen":
        await target.voice.setDeaf(false, "CamelBot staff order");
        return { handled: true, ok: true, text: "" };
      case "vckick":
        if (!target.voice.channel) return { handled: true, ok: false, text: "" };
        await target.voice.disconnect("CamelBot staff order");
        return { handled: true, ok: true, text: "" };
      case "kick":
        await target.kick("CamelBot staff order");
        return { handled: true, ok: true, text: "" };
      case "ban":
        await target.ban({ reason: "CamelBot staff order" });
        return { handled: true, ok: true, text: "" };
      case "timeout": {
        const ms = Math.min(28 * 24 * 60 * 60 * 1000, Math.max(5_000, (parsed.seconds ?? 60) * 1000));
        await target.timeout(ms, "CamelBot staff order");
        return { handled: true, ok: true, text: "" };
      }
      default:
        return { handled: false };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { handled: true, ok: false, text: msg };
  }
}

function wantsJoin(content: string): boolean {
  const f = fold(content);
  return /(?:sen(?:de)?\s+(?:de\s+)?(?:katil|gir)|sende\s+(?:katil|gir)|you\s+join|join\s+(?:too|as\s+well)|bot\s+(?:da|de)\s+(?:katil|gir)|sen\s+de\s+katil)/.test(
    f,
  );
}

function parseStaff(content: string): {
  kind: StaffKind;
  scope: "me" | "us" | "user";
  whoHint: string;
  channelHint: string;
  joinBot: boolean;
  seconds?: number;
} | null {
  const f = fold(content);
  const seconds = Number(content.match(/(\d+)\s*(?:s|sec|secs|second|seconds|sn|dk|min)?/i)?.[1] ?? 0) || undefined;
  const joinBot = wantsJoin(content);

  const us = /(?:\bbizi\b|\bus\b|\bherkes(?:i)?\b|\beveryone\b|\ball\s+(?:of\s+)?us\b)/.test(f);
  const me = /(?:\bbeni\b|\bme\b|\bkendimi\b)/.test(f);

  if (/(?:\bunmute\b|susturmayi\s*kald|susturmayı\s*kald|sesini\s*ac)/.test(f) && !/(?:kendin|yourself|bot)\b/.test(f)) {
    return { kind: "unmute", scope: "user", whoHint: content, channelHint: "", joinBot };
  }
  if (/(?:undeafen|sagirligi\s*kald|sağırlığı\s*kald)/.test(f)) {
    return { kind: "undeafen", scope: "user", whoHint: content, channelHint: "", joinBot };
  }
  if (/(?:\bmute\b|sustur)/.test(f) && !/(?:kendin|yourself|dinleme|mikrofon)/.test(f)) {
    return { kind: "mute", scope: me ? "me" : "user", whoHint: content, channelHint: "", joinBot };
  }
  if (/(?:\bdeafen\b|sagir\s*et|sağır\s*et)/.test(f)) {
    return { kind: "deafen", scope: "user", whoHint: content, channelHint: "", joinBot };
  }
  if (/(?:timeout|time\s*out)/.test(f)) {
    return { kind: "timeout", scope: "user", whoHint: content, channelHint: "", joinBot, seconds: seconds ?? 60 };
  }
  if (/(?:\bban\b|yasakla)/.test(f)) {
    return { kind: "ban", scope: "user", whoHint: content, channelHint: "", joinBot };
  }
  if (/(?:ses(?:ten|den)\s*at|voice(?:den)?\s*(?:kick|at)|disconnect|kopar|kanaldan\s*at)/.test(f)) {
    return { kind: "vckick", scope: me ? "me" : "user", whoHint: content, channelHint: "", joinBot };
  }
  if (/(?:\bkick\b|sunucudan\s*at)/.test(f) && !/(?:tasi|taşı|move)/.test(f)) {
    return { kind: "kick", scope: "user", whoHint: content, channelHint: "", joinBot };
  }
  if (/(?:tasi|taşı|tasin|taşın|\bmove\b)/.test(f)) {
    return {
      kind: "move",
      scope: us ? "us" : me || !/@/.test(content) ? "me" : "user",
      whoHint: content,
      channelHint: content,
      joinBot,
    };
  }
  return null;
}

async function resolveVoiceChannel(
  guild: Guild,
  hint: string,
  actor: GuildMember,
  mentionedChannelIds: string[],
): Promise<VoiceBasedChannel | null> {
  const channels = await listVoiceChannels(guild);

  for (const id of mentionedChannelIds) {
    const hit = channels.find((c) => c.id === id);
    if (hit) return hit;
  }

  const idMatch = hint.match(/\d{15,22}/);
  if (idMatch) {
    const hit = channels.find((c) => c.id === idMatch[0]);
    if (hit) return hit;
  }

  const f = fold(hint);
  const relative = relativeChannel(f, actor, channels);
  if (relative) return relative;

  const byName = matchChannelByName(f, channels);
  if (byName) return byName;

  return null;
}

async function listVoiceChannels(guild: Guild): Promise<VoiceBasedChannel[]> {
  await guild.channels.fetch().catch(() => undefined);
  return [...guild.channels.cache.values()]
    .filter(
      (c): c is VoiceBasedChannel =>
        c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice,
    )
    .sort((a, b) => {
      const ap = a.parent?.rawPosition ?? 0;
      const bp = b.parent?.rawPosition ?? 0;
      if (ap !== bp) return ap - bp;
      return a.rawPosition - b.rawPosition;
    });
}

function relativeChannel(
  f: string,
  actor: GuildMember,
  channels: VoiceBasedChannel[],
): VoiceBasedChannel | null {
  if (!channels.length) return null;
  const current = actor.voice.channel;
  const idx = current ? channels.findIndex((c) => c.id === current.id) : -1;

  if (/(?:en\s+ust|en\s+yukari|ilk(?:\s+kanal)?|\bfirst\b|\btop\b)/.test(f)) return channels[0] ?? null;
  if (/(?:en\s+alt|son(?:\s+kanal)?|\blast\b|\bbottom\b)/.test(f)) return channels[channels.length - 1] ?? null;

  const numbered = f.match(/(?:kanal|channel)\s*(\d+)\b/) ?? f.match(/\b(\d+)\s*(?:nci|inci|uncu|uncu|st|nd|rd|th)?\s*(?:kanal|channel)\b/);
  if (numbered?.[1]) {
    const n = Number(numbered[1]);
    if (n >= 1 && n <= channels.length) return channels[n - 1] ?? null;
  }
  if (/\bbirinci\b/.test(f)) return channels[0] ?? null;
  if (/\bikinci\b/.test(f)) return channels[1] ?? null;
  if (/\bucuncu\b/.test(f)) return channels[2] ?? null;

  if (idx < 0) return null;
  if (
    /(?:\bust\b|\byukari\b|\bup\b|\babove\b|\bonceki\b|\bprevious\b)/.test(f) &&
    /(?:kanal|channel|tasi|move|us|bizi|beni)/.test(f)
  ) {
    return channels[Math.max(0, idx - 1)] ?? null;
  }
  if (
    /(?:\balt\b|\basagi\b|\bdown\b|\bbelow\b|\bsonraki\b|\bnext\b)/.test(f) &&
    /(?:kanal|channel|tasi|move|us|bizi|beni)/.test(f)
  ) {
    return channels[Math.min(channels.length - 1, idx + 1)] ?? null;
  }
  return null;
}

function matchChannelByName(f: string, channels: VoiceBasedChannel[]): VoiceBasedChannel | null {
  const padded = ` ${f} `;
  const ranked = [...channels]
    .map((c) => ({ c, n: fold(c.name) }))
    .filter((row) => row.n.length >= 2)
    .sort((a, b) => b.n.length - a.n.length);

  for (const { c, n } of ranked) {
    if (padded.includes(` ${n} `) || padded.includes(` ${n}kanal`)) return c;
  }
  return null;
}

async function resolveMember(
  guild: Guild,
  hint: string,
  actor: GuildMember,
  mentionedUserIds: string[],
): Promise<GuildMember | null> {
  const ids = mentionedUserIds.filter((id) => id !== actor.client.user?.id);
  if (ids[0]) return guild.members.fetch(ids[0]).catch(() => null);
  const f = fold(hint);
  if (/\b(?:beni|me|kendimi)\b/.test(f)) return actor;
  const idMatch = hint.match(/\d{15,22}/);
  if (idMatch) return guild.members.fetch(idMatch[0]).catch(() => null);
  const name = f
    .replace(/\b(?:bot|camelbot|camel|mute|unmute|kick|ban|timeout|deafen|sustur|at|tasi|move|please|lutfen)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!name || name.length < 2) return null;
  const cached = await guild.members.fetch().catch(() => guild.members.cache);
  const list = [...cached.values()];
  return (
    list.find((m) => fold(m.displayName) === name || fold(m.user.username) === name) ??
    list.find((m) => fold(m.displayName).includes(name) || fold(m.user.username).includes(name)) ??
    null
  );
}

async function joinBotTo(guild: Guild, dest: VoiceBasedChannel, textChannelId?: string): Promise<void> {
  const { joinVoice } = await import("./voice.js");
  const textId = textChannelId?.trim() || dest.id;
  await joinVoice(guild.client, dest, textId);
}

function pendingKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

function takeFreshPending(key: string): PendingMove | undefined {
  const row = pendingMoves.get(key);
  if (!row) return undefined;
  if (Date.now() - row.at > PENDING_MS) {
    pendingMoves.delete(key);
    return undefined;
  }
  return row;
}

function permFor(kind: StaffKind) {
  switch (kind) {
    case "move":
    case "vckick":
      return PermissionFlagsBits.MoveMembers;
    case "mute":
    case "unmute":
      return PermissionFlagsBits.MuteMembers;
    case "deafen":
    case "undeafen":
      return PermissionFlagsBits.DeafenMembers;
    case "kick":
      return PermissionFlagsBits.KickMembers;
    case "ban":
      return PermissionFlagsBits.BanMembers;
    case "timeout":
      return PermissionFlagsBits.ModerateMembers;
  }
}

function needName(bit: bigint): string {
  if (bit === PermissionFlagsBits.MoveMembers) return "Move Members";
  if (bit === PermissionFlagsBits.MuteMembers) return "Mute Members";
  if (bit === PermissionFlagsBits.DeafenMembers) return "Deafen Members";
  if (bit === PermissionFlagsBits.KickMembers) return "Kick Members";
  if (bit === PermissionFlagsBits.BanMembers) return "Ban Members";
  if (bit === PermissionFlagsBits.ModerateMembers) return "Timeout Members";
  return "staff";
}
