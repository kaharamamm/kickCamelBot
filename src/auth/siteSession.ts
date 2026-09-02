import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type SiteSession = {
  cookie: string;
  savedAt: number;
};

const root = join(fileURLToPath(new URL(".", import.meta.url)), "../..");
const sessionPath = join(root, "data", "site-session.json");

/** Cookies Kick's site API expects on kick.com (DevTools → Application → Cookies). */
const KICK_SITE_COOKIE_NAMES = new Set([
  "XSRF-TOKEN",
  "kick_session",
  "session_token",
  "cf_clearance",
  "__cf_bm",
  "_cfuvid",
  "Fu2j2sAJdD9uNWd35LliusN1UqxwWWNKuS2AAxGK",
]);

export function loadSiteSession(): SiteSession | null {
  const fromEnv = process.env.KICK_SITE_COOKIE?.trim();
  if (fromEnv) {
    const cookie = normalizeCookieInput(fromEnv);
    return cookie ? { cookie, savedAt: Date.now() } : null;
  }

  try {
    const raw = readFileSync(sessionPath, "utf8");
    const parsed = JSON.parse(raw) as SiteSession;
    if (!parsed.cookie?.trim()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSiteSession(raw: string): SiteSession {
  const cookie = normalizeCookieInput(raw);
  if (!cookie) throw new Error("Could not parse Kick cookies from that paste.");
  const data: SiteSession = { cookie, savedAt: Date.now() };
  mkdirSync(dirname(sessionPath), { recursive: true });
  writeFileSync(sessionPath, JSON.stringify(data, null, 2), { mode: 0o600 });
  return data;
}

export function clearSiteSession(): void {
  try {
    writeFileSync(sessionPath, "{}\n", { mode: 0o600 });
  } catch {
    /* ignore */
  }
}

export function hasSiteSession(): boolean {
  const session = loadSiteSession();
  if (!session?.cookie) return false;
  if (!parseXsrfToken(session.cookie)) return false;
  return /(?:^|;\s*)kick_session=/i.test(session.cookie) || /(?:^|;\s*)session_token=/i.test(session.cookie);
}

export function parseXsrfToken(cookie: string): string | undefined {
  const match = cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/i);
  if (!match?.[1]) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function kickSiteDomain(domain: string): boolean {
  const d = domain.toLowerCase();
  return d === "kick.com" || d === ".kick.com";
}

/** Accept Cookie header text or DevTools cookie table (tab-separated name / value columns). */
export function normalizeCookieInput(raw: string): string {
  const text = raw.trim();
  if (!text) return "";

  if (text.includes(";") && !text.includes("\t")) {
    return text.replace(/\s*;\s*/g, "; ").replace(/^;\s*/, "").trim();
  }

  const pairs = new Map<string, string>();

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /^name\s/i.test(trimmed)) continue;

    if (trimmed.includes("\t")) {
      const cols = trimmed.split("\t");
      const name = cols[0]?.trim();
      const value = cols[1]?.trim();
      const domain = (cols[2] ?? "").trim();
      if (!name || !value || value === "✓") continue;
      if (domain && !kickSiteDomain(domain)) continue;
      pairs.set(name, value);
      continue;
    }

    const eq = trimmed.indexOf("=");
    if (eq > 0) {
      const name = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (name && value) pairs.set(name, value);
    }
  }

  if (pairs.size === 0) return text.includes("=") ? text : "";

  const ordered: string[] = [];
  for (const name of KICK_SITE_COOKIE_NAMES) {
    const value = pairs.get(name);
    if (value) ordered.push(`${name}=${value}`);
  }
  for (const [name, value] of pairs) {
    if (!KICK_SITE_COOKIE_NAMES.has(name)) ordered.push(`${name}=${value}`);
  }

  return ordered.join("; ");
}
