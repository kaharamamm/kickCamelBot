import { extraChannels, extraChannelSlugs, parseChannelSlug } from "./channelStore.js";
import { config } from "../config.js";
import { clipChat, getMyChannel, sendChat } from "../kick/api.js";
import { lookupPublicChannel } from "../kick/publicChannel.js";
import { fold } from "./slang.js";
import type { ChatLang } from "./lang.js";

type RemoteSay = {
  slug: string;
  text: string;
};

export function parseRemoteSay(content: string, lang: ChatLang): RemoteSay | null {
  const slugs = extraChannelSlugs();
  if (slugs.length === 0) return null;
  if (!isRemoteIntent(content)) return null;
  const slug = findRegisteredSlug(content, slugs);
  if (!slug) return null;
  const text = extractSayText(content, slug, lang);
  if (!text) return null;
  return { slug, text };
}

/** Returns an error line, or null if the order was applied silently. */
export async function runRemoteSay(job: RemoteSay, lang: ChatLang): Promise<string | null> {
  const home = await getMyChannel();
  if (job.slug === home.slug.toLowerCase()) return null;
  const userId = await resolveUserId(job.slug);
  if (!userId) {
    return lang === "en"
      ? `${job.slug} is not in my channel list.`
      : `${job.slug} kayıtlı kanallarımda yok.`;
  }
  try {
    const id = await sendChat(job.text, undefined, userId);
    if (!id) {
      return lang === "en"
        ? `Kick blocked that. Is CamelBot a mod in ${job.slug}?`
        : `Kick yazmama izin vermedi. ${job.slug} kanalında CamelBot mod mu?`;
    }
  } catch (err) {
    console.warn("[remote-say] failed", job.slug, err);
    return lang === "en" ? `Could not write in ${job.slug}.` : `${job.slug} kanalına yazamadım.`;
  }
  return null;
}

/** Short nicks from any registered slug: kaiserdoto → kaiser, foobar_tv → foobar, etc. */
function nicksFor(slug: string): string[] {
  const s = slug.toLowerCase();
  const nicks = new Set<string>([s]);
  const short = s.replace(/(?:doto|dota|ttv|kick|live|tv|gaming|yt)$/i, "");
  if (short.length >= 3 && short !== s) nicks.add(short);
  return [...nicks].sort((a, b) => b.length - a.length);
}

export function resolveRegisteredChannel(text: string): string | null {
  return findRegisteredSlug(text, extraChannelSlugs());
}

const ORDER_FILLER =
  /^(raid|host|baskin|at|et|to|ya|ye|kanal|kanala|kanalina|channel|this|the|bot|camel|camelbot|pls|please|lutfen|and|ve|go|a|e|su|bir|bi|is|are|was|for|with|from|that|just|now)$/;

/**
 * Any Kick slug mentioned in the text. Prefers a registered extra channel nick,
 * but raid/host can target channels that were never added.
 */
export function extractChannelTarget(text: string): string | null {
  const registered = resolveRegisteredChannel(text);
  if (registered) return registered;
  const url = [...text.matchAll(/kick\.com\/([a-z0-9_-]{3,25})/gi)].map((m) => m[1]?.toLowerCase() ?? "")[0];
  if (url) return url;
  const at = text.match(/(?:^|[\s,])@([a-z0-9_-]{3,25})\b/i)?.[1]?.toLowerCase();
  if (at && at !== fold(config.bot.name) && at !== "bot" && at !== "camel") return at;
  const folded = fold(text);
  const after = folded.match(/(?:raidle|hostla|raid|host|baskin)\s+(?:at|et|to|a|e)?\s*(.+)/)?.[1];
  if (!after) return null;
  for (const tok of after.split(/[^a-z0-9_]+/)) {
    if (tok.length < 3 || tok.length > 25) continue;
    if (ORDER_FILLER.test(tok)) continue;
    if (tok === fold(config.bot.name) || tok === "bot" || tok === "camel") continue;
    return tok;
  }
  return null;
}

function findRegisteredSlug(content: string, slugs: string[]): string | null {
  const folded = fold(content);
  const parsed = [...content.matchAll(/kick\.com\/([a-z0-9_-]{3,25})/gi)].map((m) => m[1]?.toLowerCase() ?? "");
  for (const slug of slugs) {
    if (parsed.includes(slug)) return slug;
    for (const nick of nicksFor(slug)) {
      if (mentionsNick(folded, nick)) return slug;
    }
  }
  const maybe = parseChannelSlug(content.replace(/https?:\/\//gi, " "));
  if (maybe && slugs.includes(maybe)) return maybe;
  return null;
}

function mentionsNick(folded: string, nick: string): boolean {
  const suffix = "(?:['']?(?:nin|nun|in|un|den|dan|de|da|ye|ya|le|la|e|a|i|u))?";
  return new RegExp(`(?:^|[^a-z0-9_])${escapeRe(nick)}${suffix}(?=$|[^a-z0-9_])`).test(folded);
}

const WRITE_END =
  String.raw`(?:yazar\s*m[ıi]s[ıi]n|yazsana|yazsene|yaz[ıi]ver|yaz|söylesene|söylesana|soylesene|söyle|soyle|dersene|dersana|desene|desana|der\s*m[ıi]s[ıi]n|de\s*m[ıi]s[ıi]n|sor(?:ar)?(?:\s*m[ıi]s[ıi]n)?|sorsene|sorsana|ask|say)(?:\s+(?:@?camelbot|@?camel|bot))?\s*\??\s*$`;

function isRemoteIntent(content: string): boolean {
  const f = fold(content);
  return (
    /(?:join|katil|gidip|\bgit\b|kanal|channel|yazar\s*mi|yazsana|yazsene|dersene|der\s*mi|soyle|soyley|\byaz\b|\bsor\b|sorsene|ask\b|say\b|merhaba|hello|selam)/.test(
      f,
    ) && /(?:kanal|channel|join|katil|gidip|\bgit\b|yaz|soyle|der|sor|ask)/.test(f)
  );
}

function extractSayText(content: string, slug: string, lang: ChatLang): string {
  const quoted = content.match(/['"`“”‘’]([^'"`“”‘’]+)['"`“”‘’]/);
  if (quoted?.[1]?.trim()) return clipChat(quoted[1].trim());

  const goWrite = content.match(
    new RegExp(String.raw`\b(?:gidip|git|go(?:\s+to)?)\b\s+(.+?)\s+${WRITE_END}`, "i"),
  );
  if (goWrite?.[1]) return cleanPayload(goWrite[1], slug, lang);

  const cut = content.replace(new RegExp(String.raw`^(.*?)\s+${WRITE_END}`, "i"), "$1");
  return cleanPayload(cut, slug, lang);
}

function cleanPayload(raw: string, slug: string, lang: ChatLang): string {
  const kept: string[] = [];
  for (const tok of raw.split(/[\s,]+/).filter(Boolean)) {
    if (isCommandWord(fold(tok), slug)) continue;
    kept.push(tok.replace(/^['"`“”‘’]|['"`“”‘’]$/g, ""));
  }
  const text = clipChat(kept.join(" ").trim());
  if (text) return text;
  if (/(merhaba|hello|selam)/i.test(raw)) return lang === "en" ? "Hello." : "Merhaba.";
  return lang === "en" ? "Hello." : "Merhaba.";
}

function isCommandWord(token: string, slug: string): boolean {
  if (!token) return true;
  const t = fold(token).replace(/^@/, "");
  if (nicksFor(slug).some((nick) => t === nick || (t.startsWith(nick) && t.length <= nick.length + 6))) {
    return true;
  }
  if (t === fold(config.bot.name) || t === "camel" || t === "bot") return true;
  if (/^katil/.test(t)) return true;
  if (/^yaz(sana|sene|iver)?$/.test(t)) return true;
  if (/^(soyle)(sene|sana)?$/.test(t)) return true;
  if (/^(de|der)(sene|sana)?$/.test(t)) return true;
  if (/^(sor)(sene|sana|ar)?$/.test(t)) return true;
  return /^(join|gir|gidip|git|kanal|kanala|kanalina|kanalima|kanalim|channel|and|ve|go|to|ya|ye|bi|bir|su|this|the|say|yazar|misin|musun|mi|mu|pls|please|lutfen|benim|bizim|kendi|olup|olmadigini|olmadığı|ihtiyaci|ihtiyacı|yardima|yardıma|mesajini|mesajını|o)$/.test(
    t,
  );
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function resolveUserId(slug: string): Promise<number | null> {
  const saved = extraChannels().find((c) => c.slug === slug);
  if (saved?.userId) return saved.userId;
  try {
    return (await lookupPublicChannel(slug)).userId;
  } catch {
    return null;
  }
}
