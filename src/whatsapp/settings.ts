import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const path = join(fileURLToPath(new URL(".", import.meta.url)), "../../data/whatsapp.json");

export type WhatsAppKnownEntry = {
  id: string;
  name: string;
  lastSeenAt: number;
  /** Group description or contact about/status line. */
  about?: string;
};

export type WhatsAppSettings = {
  /** Chat JIDs that may receive replies. Empty = reply nowhere. */
  allowlist: string[];
  /** When true, never reply (kill switch). */
  paused: boolean;
  knownGroups: WhatsAppKnownEntry[];
  knownChats: WhatsAppKnownEntry[];
};

const MAX_KNOWN = 200;

function emptySettings(): WhatsAppSettings {
  return { allowlist: [], paused: false, knownGroups: [], knownChats: [] };
}

export function isWhatsAppGroupJid(id: string): boolean {
  return id.endsWith("@g.us");
}

export function isWhatsAppDmJid(id: string): boolean {
  return (
    id.endsWith("@s.whatsapp.net") ||
    id.endsWith("@lid") ||
    (id.includes("@") && !isWhatsAppGroupJid(id) && !id.includes("status") && !id.includes("broadcast") && !id.includes("newsletter"))
  );
}

function asJidList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of value) {
    const id = String(row ?? "").trim();
    if (!id || seen.has(id) || !id.includes("@")) continue;
    if (id.includes("status@") || id.endsWith("@broadcast") || id.includes("@newsletter")) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function asKnownEntries(value: unknown, kind: "group" | "dm"): WhatsAppKnownEntry[] {
  if (!Array.isArray(value)) return [];
  const out: WhatsAppKnownEntry[] = [];
  const seen = new Set<string>();
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const r = row as Partial<WhatsAppKnownEntry>;
    const id = String(r.id ?? "").trim();
    if (!id || seen.has(id)) continue;
    if (kind === "group" && !isWhatsAppGroupJid(id)) continue;
    if (kind === "dm" && !isWhatsAppDmJid(id)) continue;
    seen.add(id);
    out.push({
      id,
      name: String(r.name ?? id).trim() || id,
      lastSeenAt: Number(r.lastSeenAt) || Date.now(),
      about: String(r.about ?? "").trim() || undefined,
    });
  }
  return out.sort((a, b) => b.lastSeenAt - a.lastSeenAt).slice(0, MAX_KNOWN);
}

function asSettings(value: unknown): WhatsAppSettings {
  if (!value || typeof value !== "object") return emptySettings();
  const v = value as Partial<WhatsAppSettings> & { known?: unknown };
  // Legacy: only knownGroups existed; pull DMs out of allowlist-only if needed
  return {
    allowlist: asJidList(v.allowlist),
    paused: Boolean(v.paused),
    knownGroups: asKnownEntries(v.knownGroups, "group"),
    knownChats: asKnownEntries(v.knownChats, "dm"),
  };
}

function readSettings(): WhatsAppSettings {
  try {
    if (!existsSync(path)) {
      const initial = emptySettings();
      writeSettings(initial);
      return initial;
    }
    return asSettings(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return emptySettings();
  }
}

function writeSettings(settings: WhatsAppSettings): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify(
      {
        allowlist: settings.allowlist,
        paused: settings.paused,
        knownGroups: settings.knownGroups.slice(0, MAX_KNOWN),
        knownChats: settings.knownChats.slice(0, MAX_KNOWN),
      },
      null,
      2,
    ),
  );
}

let cache: WhatsAppSettings | null = null;
let writeTimer: ReturnType<typeof setTimeout> | undefined;
let pendingWrite: WhatsAppSettings | null = null;

function flushWrite(): void {
  writeTimer = undefined;
  if (!pendingWrite) return;
  const settings = pendingWrite;
  pendingWrite = null;
  writeSettings(settings);
  console.log(
    `[whatsapp] wrote allowlist=${settings.allowlist.length} paused=${settings.paused} groups=${settings.knownGroups.length} chats=${settings.knownChats.length}`,
  );
}

export function getWhatsAppSettings(): WhatsAppSettings {
  if (!cache) cache = readSettings();
  return cache;
}

export function reloadWhatsAppSettings(): WhatsAppSettings {
  if (writeTimer) {
    clearTimeout(writeTimer);
    flushWrite();
  }
  cache = readSettings();
  return cache;
}

export function saveWhatsAppSettings(next: WhatsAppSettings, opts?: { immediate?: boolean }): WhatsAppSettings {
  const normalized: WhatsAppSettings = {
    allowlist: asJidList(next.allowlist),
    paused: Boolean(next.paused),
    knownGroups: asKnownEntries(next.knownGroups, "group"),
    knownChats: asKnownEntries(next.knownChats, "dm"),
  };
  cache = normalized;
  pendingWrite = normalized;
  if (writeTimer) clearTimeout(writeTimer);
  if (opts?.immediate) {
    flushWrite();
  } else {
    // Debounce directory churn from history/contacts sync
    writeTimer = setTimeout(flushWrite, 400);
  }
  return normalized;
}

export function isAllowlisted(chatId: string): boolean {
  const id = chatId.trim();
  if (!id) return false;
  return getWhatsAppSettings().allowlist.includes(id);
}

export function isWhatsAppPaused(): boolean {
  return getWhatsAppSettings().paused;
}

export function setWhatsAppPaused(paused: boolean): WhatsAppSettings {
  const cur = getWhatsAppSettings();
  return saveWhatsAppSettings({ ...cur, paused }, { immediate: true });
}

export function setWhatsAppAllowlist(ids: string[]): WhatsAppSettings {
  const cur = getWhatsAppSettings();
  return saveWhatsAppSettings({ ...cur, allowlist: ids }, { immediate: true });
}

/** Drop a chat/group from the allowlist only (keeps it in browse lists). */
export function removeFromWhatsAppAllowlist(id: string): WhatsAppSettings {
  const jid = id.trim();
  const cur = getWhatsAppSettings();
  return saveWhatsAppSettings(
    {
      ...cur,
      allowlist: cur.allowlist.filter((x) => x !== jid),
    },
    { immediate: true },
  );
}

/** Drop a chat/group from the dashboard lists and allowlist. */
export function removeWhatsAppKnown(id: string): WhatsAppSettings {
  const jid = id.trim();
  const cur = getWhatsAppSettings();
  return saveWhatsAppSettings(
    {
      ...cur,
      allowlist: cur.allowlist.filter((x) => x !== jid),
      knownGroups: cur.knownGroups.filter((x) => x.id !== jid),
      knownChats: cur.knownChats.filter((x) => x.id !== jid),
    },
    { immediate: true },
  );
}

function upsertKnown(
  list: WhatsAppKnownEntry[],
  id: string,
  name: string,
  now: number,
  about?: string,
): { list: WhatsAppKnownEntry[]; changed: boolean } {
  const existing = list.find((g) => g.id === id);
  const label = name.trim() || existing?.name || id;
  const aboutLine = (about ?? existing?.about ?? "").trim() || undefined;
  if (
    existing &&
    existing.name === label &&
    (existing.about || undefined) === aboutLine &&
    now - existing.lastSeenAt < 60_000
  ) {
    return { list, changed: false };
  }
  const rest = list.filter((g) => g.id !== id);
  return {
    list: [{ id, name: label, lastSeenAt: now, about: aboutLine }, ...rest].slice(0, MAX_KNOWN),
    changed: true,
  };
}

export function rememberWhatsAppGroup(id: string, name?: string, about?: string): void {
  const jid = id.trim();
  if (!isWhatsAppGroupJid(jid)) return;
  const cur = getWhatsAppSettings();
  const now = Date.now();
  const next = upsertKnown(cur.knownGroups, jid, name ?? "", now, about);
  if (!next.changed) return;
  saveWhatsAppSettings({ ...cur, knownGroups: next.list });
}

export function rememberWhatsAppChat(id: string, name?: string, about?: string): void {
  const jid = id.trim();
  if (!isWhatsAppDmJid(jid)) return;
  const cur = getWhatsAppSettings();
  const now = Date.now();
  const next = upsertKnown(cur.knownChats, jid, name ?? "", now, about);
  if (!next.changed) return;
  saveWhatsAppSettings({ ...cur, knownChats: next.list });
}

/** Ensure the linked account appears in Chats 1:1 (Message yourself). */
export function ensureSelfChat(phoneDigits: string | null | undefined, _extraJids: string[] = []): void {
  const digits = String(phoneDigits ?? "").replace(/\D/g, "");
  if (digits.length < 8) return;
  const id = `${digits}@s.whatsapp.net`;
  const label = `You (Message yourself) · +${digits}`;

  const cur = getWhatsAppSettings();
  const now = Date.now();
  const r = upsertKnown(cur.knownChats, id, label, now);
  const selfRows = r.list.filter((c) => c.id === id);
  const rest = r.list.filter((c) => c.id !== id);
  const pinned = [...selfRows, ...rest];
  const orderChanged = pinned[0]?.id !== cur.knownChats[0]?.id;
  if (!r.changed && !orderChanged) return;
  saveWhatsAppSettings({ ...cur, knownChats: pinned });
}

/** Bulk upsert without writing on every item. */
export function rememberWhatsAppMany(
  groups: Array<{ id: string; name?: string; about?: string }>,
  chats: Array<{ id: string; name?: string; about?: string }>,
): void {
  const cur = getWhatsAppSettings();
  const now = Date.now();
  let groupList = [...cur.knownGroups];
  let chatList = [...cur.knownChats];
  let changed = false;

  for (const g of groups) {
    const id = g.id.trim();
    if (!isWhatsAppGroupJid(id)) continue;
    const r = upsertKnown(groupList, id, g.name ?? "", now, g.about);
    groupList = r.list;
    if (r.changed) changed = true;
  }
  for (const c of chats) {
    const id = c.id.trim();
    if (!isWhatsAppDmJid(id)) continue;
    const r = upsertKnown(chatList, id, c.name ?? "", now, c.about);
    chatList = r.list;
    if (r.changed) changed = true;
  }
  if (!changed) return;
  saveWhatsAppSettings({ ...cur, knownGroups: groupList, knownChats: chatList });
}

export function parseAllowlistForm(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const raw = (body as Record<string, unknown>).allowlist;
  if (Array.isArray(raw)) return asJidList(raw);
  if (typeof raw === "string") return asJidList([raw]);
  return [];
}
