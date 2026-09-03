/** In-memory recall of what CamelBot last said (voice + text) on Discord. */

type SpokenRow = { text: string; at: number; userKey?: number };
type TextRow = { text: string; at: number; guildId?: string };

const lastSpokenByGuild = new Map<string, SpokenRow>();
const lastSpokenByUser = new Map<number, SpokenRow>();
const lastTextByUser = new Map<number, TextRow>();

const MAX_AGE_MS = 30 * 60_000;

function fresh<T extends { at: number }>(row: T | undefined): T | undefined {
  if (!row) return undefined;
  if (Date.now() - row.at > MAX_AGE_MS) return undefined;
  return row;
}

export function rememberSpoken(guildId: string, text: string, userKey?: number): void {
  const clean = text.replace(/\s+/g, " ").trim().slice(0, 500);
  if (!clean) return;
  const row: SpokenRow = { text: clean, at: Date.now(), userKey };
  lastSpokenByGuild.set(guildId, row);
  if (userKey != null) lastSpokenByUser.set(userKey, { ...row });
}

export function rememberBotText(userKey: number, text: string, guildId?: string): void {
  const clean = text.replace(/\s+/g, " ").trim().slice(0, 500);
  if (!clean) return;
  lastTextByUser.set(userKey, { text: clean, at: Date.now(), guildId });
}

export function getLastSpoken(guildId?: string, userKey?: number): string | undefined {
  if (guildId) {
    const g = fresh(lastSpokenByGuild.get(guildId));
    if (g?.text) return g.text;
  }
  if (userKey != null) {
    const u = fresh(lastSpokenByUser.get(userKey));
    if (u?.text) return u.text;
  }
  return undefined;
}

/** Prefer last voice line, else last text reply. */
export function getLastBotLine(guildId?: string, userKey?: number): string | undefined {
  const spoken = getLastSpoken(guildId, userKey);
  if (spoken) return spoken;
  if (userKey != null) {
    const t = fresh(lastTextByUser.get(userKey));
    if (t?.text) return t.text;
  }
  return undefined;
}
