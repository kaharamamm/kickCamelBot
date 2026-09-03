import { ChannelType, type Client, type VoiceBasedChannel } from "discord.js";
import { botFail, botOk, botThink } from "../bot/activityLog.js";
import type { ChatLang } from "../bot/lang.js";
import { detectLang } from "../bot/lang.js";
import { generateLine, rememberExchange } from "../bot/ai.js";
import { discordKingUserId } from "./identities.js";
import { getDiscordRouting } from "./settings.js";
import { joinVoice, leaveVoice, speakInGuild, isInVoiceGuild } from "./voice.js";

async function discordClient(): Promise<Client | undefined> {
  const { getDiscordClient } = await import("./client.js");
  return getDiscordClient();
}

export type MemberVoiceSpot = {
  guildId: string;
  channel: VoiceBasedChannel;
  textChannelId: string;
};

/** Find which Discord voice channel a user is in (scan routed guilds, then all bot guilds). */
export async function findMemberVoiceChannel(
  discordUserId: string,
  preferredGuildId?: string,
): Promise<MemberVoiceSpot | null> {
  const client = await discordClient();
  if (!client?.isReady()) return null;

  const routes = getDiscordRouting().routes;
  const guildIds: string[] = [];
  if (preferredGuildId) guildIds.push(preferredGuildId);
  for (const r of routes) {
    if (!guildIds.includes(r.guildId)) guildIds.push(r.guildId);
  }
  for (const g of client.guilds.cache.values()) {
    if (!guildIds.includes(g.id)) guildIds.push(g.id);
  }

  for (const guildId of guildIds) {
    try {
      const guild = await client.guilds.fetch(guildId);
      const member = await guild.members.fetch(discordUserId).catch(() => null);
      const ch = member?.voice.channel;
      if (ch && (ch.type === ChannelType.GuildVoice || ch.type === ChannelType.GuildStageVoice)) {
        const route = routes.find((r) => r.guildId === guildId);
        const textChannelId = route?.listenChannelId || ch.id;
        return { guildId, channel: ch, textChannelId };
      }
    } catch {
      /* try next guild */
    }
  }
  return null;
}

/** King's current Discord voice channel (by configured Discord king user id). */
export async function findKingVoiceChannel(preferredGuildId?: string): Promise<MemberVoiceSpot | null> {
  return findMemberVoiceChannel(discordKingUserId(), preferredGuildId);
}

export type DiscordVoiceBridgeOrder = {
  join?: boolean;
  leave?: boolean;
  /** Exact words to speak */
  say?: string;
  /** Invent a take about this topic instead of saying `say` */
  topic?: string;
  mode?: "verbatim" | "riff" | "repeat" | "join_only";
  lang?: ChatLang;
};

/**
 * Execute a Discord voice order ordered from Kick (or anywhere):
 * resolve the king's current VC → join → speak.
 */
export async function runDiscordVoiceBridge(
  order: DiscordVoiceBridgeOrder,
  opts?: { who?: string; userKey?: number },
): Promise<{ ok: true; detail: string } | { ok: false; error: string }> {
  const client = await discordClient();
  if (!client?.isReady()) {
    return { ok: false, error: "Discord bot is offline." };
  }

  const lang = order.lang ?? "tr";
  const mode = order.mode ?? (order.topic ? "riff" : order.say ? "verbatim" : "join_only");

  try {
    if (order.leave) {
      const routes = getDiscordRouting().routes;
      const guildId = routes[0]?.guildId;
      if (guildId) await leaveVoice(guildId);
      else {
        for (const g of client.guilds.cache.keys()) await leaveVoice(g);
      }
      botOk("voice", "Left Discord voice (Kick order)");
      return { ok: true, detail: lang === "en" ? "Left Discord voice." : "Discord sesten çıktım." };
    }

    const needJoin = order.join !== false && (mode !== "repeat" || !order.join);
    let spot: MemberVoiceSpot | null = null;

    if (needJoin || mode === "join_only" || mode === "verbatim" || mode === "riff" || mode === "repeat") {
      spot = await findKingVoiceChannel();
      if (!spot && (mode === "join_only" || order.join || mode === "verbatim" || mode === "riff")) {
        return {
          ok: false,
          error:
            lang === "en"
              ? "You're not in a Discord voice channel — join one first, then order me in."
              : "Discord ses kanalında değilsin — önce bir kanala gir, sonra söyle.",
        };
      }
      if (spot && (order.join !== false || mode === "join_only" || !isInVoiceGuild(spot.guildId))) {
        botThink("voice", `Kick→Discord join ${spot.channel.name}`);
        await joinVoice(client, spot.channel, spot.textChannelId);
        botOk("voice", `Joined ${spot.channel.name} (from Kick)`);
      }
    }

    if (mode === "join_only") {
      return {
        ok: true,
        detail: lang === "en" ? `Joined ${spot?.channel.name ?? "voice"}.` : `${spot?.channel.name ?? "Ses"} kanalına girdim.`,
      };
    }

    const guildId = spot?.guildId ?? getDiscordRouting().routes[0]?.guildId;
    if (!guildId || !isInVoiceGuild(guildId)) {
      return {
        ok: false,
        error:
          lang === "en"
            ? "I'm not in Discord voice. Join a call and tell me to come in."
            : "Discord seste değilim. Çağrıya girip katıl demen lazım.",
      };
    }

    let line: string | null = null;
    if (mode === "repeat") {
      const { getLastBotLine } = await import("./speechMemory.js");
      line = getLastBotLine(guildId, opts?.userKey) ?? null;
      if (!line) {
        return {
          ok: false,
          error: lang === "en" ? "Nothing to repeat yet." : "Tekrar edecek bir şey yok.",
        };
      }
    } else if (mode === "riff" && (order.topic || order.say)) {
      const topic = order.topic || order.say || "";
      line = await inventTake(topic, lang, opts?.who ?? "king");
      if (!line && /halim|hatir|hatr|hatır|nasil|nasıl|how\s+are/i.test(topic)) {
        line =
          lang === "en"
            ? "Hey, how are you doing? Just checking in on you."
            : "Ey kanka nasılsın, halin hatırın iyi mi?";
      }
    } else if (order.say) {
      line = order.say;
    }

    if (line) {
      const spoken = await speakInGuild(guildId, line, {
        lang: detectLang(line, opts?.userKey),
        userKey: opts?.userKey,
      });
      if (!spoken.ok) return { ok: false, error: spoken.error };
      if (opts?.userKey != null) rememberExchange(opts.userKey, `[discord-order]`, `[voice] ${line}`);
      botOk("voice", `Spoke from Kick: ${line.slice(0, 60)}`);
      return { ok: true, detail: lang === "en" ? "Said it on Discord." : "Discord'ta söyledim." };
    }

    return { ok: true, detail: lang === "en" ? "Done." : "Tamam." };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    botFail("voice", `Kick→Discord fail: ${msg}`);
    return { ok: false, error: msg };
  }
}

async function inventTake(topic: string, lang: ChatLang, who: string): Promise<string | null> {
  const text = await generateLine(
    [
      "You are CamelBot. Speak a short Discord TTS line.",
      "1–3 sentences. Do what the topic asks (e.g. if it says ask how they are, actually ASK them — nasılsın / how are you).",
      "Your own natural wording — do not read the topic back word-for-word.",
      "No *actions*. No meta. No Kick emote tags.",
      lang === "en" ? "English only." : "Turkish only.",
      `What to do / topic: ${topic}`,
      `Asked by: ${who}`,
    ].join("\n"),
    { timeoutMs: 12_000 },
  );
  return text?.replace(/\*[^*]+\*/g, " ").replace(/\s+/g, " ").trim() || null;
}

/** True when the message is about Discord voice / DC channel (not Kick chat). */
export function looksLikeDiscordVoiceOrder(content: string): boolean {
  const f = content
    .toLowerCase()
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c");
  return (
    /\b(?:dc|discord)\b/.test(f) ||
    /discord\s*(?:ses|kanal|call|voice|vc)/.test(f) ||
    /(?:benim|oldugum|olduğum).{0,24}(?:dc|discord|ses\s*kanal|call|vc)/.test(f) ||
    /(?:dc|discord).{0,24}(?:kanal|ses|call|gir|katil|join)/.test(f) ||
    /(?:ses\s*kanal|voice\s*channel|vc).{0,20}(?:gir|katil|join)/.test(f)
  );
}

/**
 * Heuristic parse: "camel benim olduğum DC kanalına gir ve selam kralım de"
 * → join king's VC + say "selam kralım"
 * Also: "dc ye gelip bana hali hatırımı sor" → join + invent a check-in line (riff)
 */
export function parseDiscordVoiceOrderHeuristic(content: string): DiscordVoiceBridgeOrder | null {
  if (!looksLikeDiscordVoiceOrder(content) && !/\b(?:gir|katil|join|gelip|gel)\b/i.test(content)) {
    if (!/discord|dc/i.test(content)) return null;
  }
  if (!looksLikeDiscordVoiceOrder(content)) return null;

  const folded = content
    .toLowerCase()
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c");

  const leave = /(?:cik|ayril|leave|disconnect)/i.test(folded);
  if (leave) {
    return {
      leave: true,
      mode: "join_only",
      lang: /[a-z]{4,}/i.test(content) && !/[çğıöşüİ]/i.test(content) ? "en" : "tr",
    };
  }

  const join =
    /(?:gir|girip|katil|katilip|join|baglan|baglanip|gelip|\bgel\b|come(?:\s+to)?)/i.test(folded) ||
    /kanal(?:a|ina|ina)/i.test(folded) ||
    /(?:dc|discord).{0,40}(?:ye|ya|e)\s/i.test(folded);

  // "… ve selam kralım de" / "say hello king"
  const sayMatch =
    content.match(/\b(?:ve|and|,)\s*(.+?)\s+de(?:\b|[.!?…]|$)/i) ||
    content.match(/\bde\s*[:：]\s*["“”']?(.+?)["“”']?\s*$/i) ||
    content.match(/\bsay\s+["“”']?(.+?)["“”']?\s*$/i) ||
    content.match(/\b(?:söyle|soyle)\s*[:：]\s*["“”']?(.+?)["“”']?\s*$/i);

  let say = sayMatch?.[1]?.replace(/\s+/g, " ").trim();
  if (say) {
    say = say
      .replace(/^(?:bana\s+)/i, "")
      .replace(/\b(?:sesli|discord|dc)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // "selam kralım de" at end without "ve"
  if (!say) {
    const endDe = content.match(/\b([^\n,]{2,60}?)\s+de\s*$/i);
    const endPhrase = endDe?.[1]?.trim();
    if (endPhrase && !/kanal|gir|katil|discord|dc|camel|gelip|\bgel\b/i.test(endPhrase)) {
      say = endPhrase;
    }
  }

  // "bana hali hatırımı sor" / "ask me how I am" → invent the spoken check-in (riff)
  let topic: string | undefined;
  if (!say) {
    const askTr =
      content.match(/\bbana\s+(.+?)\s+sor(?:ar\s*m[ıi]s[ıi]n|sana)?\s*$/i) ||
      content.match(/(?:gelip|girip|katılıp|katilip)\s+(?:bana\s+)?(.+?)\s+sor(?:ar\s*m[ıi]s[ıi]n)?\s*$/i) ||
      content.match(/\b(?:ve|and)\s+(?:bana\s+)?(.+?)\s+sor(?:ar\s*m[ıi]s[ıi]n)?\s*$/i);
    const askEn =
      content.match(/\bask\s+(?:me\s+)?(?:about\s+)?(.+?)\s*$/i) ||
      (/\b(?:check\s+(?:in|on)\s+(?:me|how\s+i(?:'m|am))|how\s+(?:am\s+i|i(?:'m|am)\s+doing))\b/i.test(content)
        ? (["how they're doing"] as unknown as RegExpMatchArray)
        : null);
    let rawAsk = (askTr?.[1] || (Array.isArray(askEn) && askEn[1] ? askEn[1] : askEn ? "how they're doing" : "") || "")
      .toString()
      .replace(/\s+/g, " ")
      .trim();

    if (!rawAsk && /\b(?:halim|hatirim|hatırım|nasilsin|nasılsın|how\s+are\s+you|check\s+in)\b/i.test(folded)) {
      rawAsk = "halini hatırını sor — nazikçe nasılsın diye sor";
    }

    if (rawAsk && rawAsk.length >= 3 && rawAsk.length <= 140) {
      topic = rawAsk
        .replace(/^(?:@?camel(?:bot)?|bot)\s+/i, "")
        .replace(/^(?:benim\s+)?(?:dc|discord)\b[\s\S]*?(?:gelip|girip|katilip|ve|and)\s*/i, "")
        .replace(/^(?:bana\s+)/i, "")
        .replace(/\s+/g, " ")
        .trim();
      if (!topic || /^(?:dc|discord|kanal|ses)$/i.test(topic)) {
        topic = "halini hatırını sor — nazikçe nasılsın diye sor";
      } else if (/halim|hatir|hatr|hatır|nasil|nasıl/i.test(topic) && !/sor/i.test(topic)) {
        topic = `${topic} — sesli olarak nazikçe sor (nasılsın / halin hatırın nasıl)`;
      }
    }
  }

  if (say && say.length > 120) say = say.slice(0, 120);
  if (topic && topic.length > 140) topic = topic.slice(0, 140);

  if (topic) return { join: true, topic, mode: "riff" };
  if (say) return { join: true, say, mode: "verbatim" };
  if (join) return { join: true, mode: "join_only" };
  return null;
}
