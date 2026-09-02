import { clipChat } from "../kick/api.js";
import { generateLine } from "./ai.js";
import type { ChatLang } from "./lang.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const SITE_ALIAS: Record<string, string> = {
  wikipedia: "wikipedia.org",
  wiki: "wikipedia.org",
  youtube: "youtube.com",
  reddit: "reddit.com",
  liquipedia: "liquipedia.net",
  opendota: "opendota.com",
  dotabuff: "dotabuff.com",
  steam: "steampowered.com",
  twitter: "x.com",
  x: "x.com",
};

export type WebSearchAsk = {
  query: string;
  site?: string;
  url?: string;
};

const lastSearch = new Map<number, number>();

export function classifyWebSearch(content: string): WebSearchAsk | null {
  const url = firstHttpUrl(content);
  const site = detectSite(content);
  const wants =
    /(search|google|look\s*up|lookup|internette|internetten|web['’]?de|araştır|arastir|wikipedia|\bwiki\b)/i.test(
      content,
    ) ||
    /(?:internet|google|web).{0,24}\bara\b|\bara\b.{0,24}(?:internet|google|web)/i.test(content) ||
    /(şu sitede|su sitede|this site|sitesinde|sitesine bak|look (?:this|it) up on)/i.test(content) ||
    Boolean(url && /(bak|look|oku|aç|ac|fetch|open|check|nedir)/i.test(content));
  if (!wants) return null;
  if (url) return { query: queryFromContent(content, url), url, site };
  const query = queryFromContent(content);
  if (query.length < 2) return null;
  return { query, site };
}

export function allowWebSearch(userId: number, king: boolean): boolean {
  if (king) return true;
  const last = lastSearch.get(userId) ?? 0;
  if (Date.now() - last < 25_000) return false;
  lastSearch.set(userId, Date.now());
  return true;
}

export async function answerWebSearch(ask: WebSearchAsk, lang: ChatLang, original: string): Promise<string> {
  const facts = ask.url ? await readPublicPage(ask.url) : await searchWeb(ask.query, ask.site);
  if (!facts) {
    return lang === "en" ? "Search came up empty. Try a clearer query." : "Bir şey bulamadım. Daha net yaz.";
  }
  const spoken = await generateLine(
    [
      `They asked: ${original.slice(0, 220)}`,
      `WEB FACTS (do not invent beyond this): ${facts.slice(0, 1400)}`,
      lang === "en"
        ? "Answer in English. One Kick chat reply. Use the facts. Name the site if you can. No URLs longer than needed."
        : "Türkçe cevap ver. Tek Kick mesajı. Sadece bu gerçeklere dayan. Site adı söyle. Uzun link yapıştırma.",
    ].join("\n"),
    { omitLore: true, timeoutMs: 8000 },
  );
  return spoken || clipChat(facts);
}

async function searchWeb(query: string, site?: string): Promise<string | null> {
  const q = site ? `${query} site:${site}` : query;
  const ddg = await duckDuckGo(q);
  if (ddg) return ddg;
  if (!site || /wikipedia\.org/i.test(site)) {
    const wiki = await wikipedia(query);
    if (wiki) return wiki;
  }
  return null;
}

async function duckDuckGo(query: string): Promise<string | null> {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(7000) });
    if (!res.ok) return htmlDuckDuckGo(query);
    const json = (await res.json()) as {
      AbstractText?: string;
      AbstractSource?: string;
      Answer?: string;
      Definition?: string;
      Heading?: string;
      RelatedTopics?: Array<{ Text?: string; FirstURL?: string } | { Topics?: Array<{ Text?: string }> }>;
    };
    const bits = [json.Heading, json.AbstractText, json.Answer, json.Definition].filter(
      (s): s is string => Boolean(s && s.trim()),
    );
    const related = (json.RelatedTopics ?? [])
      .flatMap((row) => ("Text" in row && row.Text ? [row.Text] : "Topics" in row ? row.Topics?.map((t) => t.Text ?? "") ?? [] : []))
      .filter(Boolean)
      .slice(0, 3);
    const text = [...bits, ...related].join(" · ");
    if (text.trim().length > 40) {
      return `${json.AbstractSource ? `${json.AbstractSource}: ` : ""}${text}`;
    }
    return htmlDuckDuckGo(query);
  } catch {
    return htmlDuckDuckGo(query);
  }
}

async function htmlDuckDuckGo(query: string): Promise<string | null> {
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: { "user-agent": UA, accept: "text/html" },
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const titles = [...html.matchAll(/class="result__a"[^>]*>([^<]+)/gi)].map((m) => decode(m[1] ?? ""));
    const snips = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi)].map((m) =>
      strip(m[1] ?? ""),
    );
    const lines: string[] = [];
    for (let i = 0; i < Math.min(3, titles.length); i++) {
      const line = [titles[i], snips[i]].filter(Boolean).join(" — ");
      if (line) lines.push(line);
    }
    return lines.length ? lines.join(" | ") : null;
  } catch {
    return null;
  }
}

async function wikipedia(query: string): Promise<string | null> {
  try {
    const url =
      `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}` +
      `&srlimit=1&utf8=1&format=json&origin=*`;
    const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const json = (await res.json()) as { query?: { search?: Array<{ title?: string; snippet?: string }> } };
    const hit = json.query?.search?.[0];
    if (!hit?.title) return null;
    return `Wikipedia: ${hit.title} — ${strip(hit.snippet ?? "")}`;
  } catch {
    return null;
  }
}

async function readPublicPage(raw: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!isPublicHost(parsed.hostname)) return null;
  try {
    const res = await fetch(parsed.toString(), {
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(7000),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    const buf = await res.arrayBuffer();
    const text = new TextDecoder("utf-8").decode(buf.slice(0, 80_000));
    if (type.includes("json")) return text.slice(0, 1500);
    const title = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    const body = strip(text.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " "));
    return [title ? strip(title) : parsed.hostname, body.slice(0, 1400)].filter(Boolean).join(" — ");
  } catch {
    return null;
  }
}

function isPublicHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (h === "localhost" || h.endsWith(".localhost") || h === "0.0.0.0") return false;
  if (h === "::1" || h.startsWith("127.") || h.startsWith("10.") || h.startsWith("192.168.") || h.startsWith("169.254.")) {
    return false;
  }
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return false;
  return true;
}

function detectSite(content: string): string | undefined {
  const lower = content.toLowerCase();
  for (const [name, domain] of Object.entries(SITE_ALIAS)) {
    if (new RegExp(`\\b${name}\\b`, "i").test(lower)) return domain;
  }
  const domain = content.match(/\b([a-z0-9-]+\.(?:com|net|org|io|gg|tv))\b/i)?.[1];
  return domain?.toLowerCase();
}

function queryFromContent(content: string, url?: string): string {
  let q = content
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/@\w+/g, " ")
    .replace(
      /\b(camelbot|camel|bot|please|lütfen|lutfen|go|gidip|search|google|look\s*up|lookup|internette|internetten|web['’]?de|araştır|arastir|ara|bak|wiki|wikipedia|for me|for us|şu sitede|this site|sitesinde)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  if (!q && url) q = url;
  return q.slice(0, 180);
}

function firstHttpUrl(content: string): string | undefined {
  const raw = content.match(/https?:\/\/[^\s<>\]]+/i)?.[0]?.replace(/[).,!?]+$/, "");
  return raw;
}

function strip(html: string): string {
  return decode(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim();
}

function decode(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/<span[^>]*>/gi, "")
    .replace(/<\/span>/gi, "");
}
