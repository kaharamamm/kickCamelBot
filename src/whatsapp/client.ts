import { Boom } from "@hapi/boom";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  areJidsSameUser,
  fetchLatestBaileysVersion,
  getContentType,
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  isJidStatusBroadcast,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pino from "pino";
import QRCode from "qrcode";
import { botFail, botOk, botThink } from "../bot/activityLog.js";
import { enqueueWork } from "../bot/workQueue.js";
import {
  getWhatsAppSettings,
  isAllowlisted,
  rememberWhatsAppChat,
  rememberWhatsAppGroup,
  rememberWhatsAppMany,
  ensureSelfChat,
  reloadWhatsAppSettings,
} from "./settings.js";
import { stripKickEmoteTokens } from "./emotes.js";

const authDir = join(fileURLToPath(new URL(".", import.meta.url)), "../../data/whatsapp-auth");
const logger = pino({ level: "silent" });

let sock: WASocket | undefined;
let starting = false;
let restartTimer: ReturnType<typeof setTimeout> | undefined;
let qrDataUrl: string | null = null;
let qrUpdatedAt: number | null = null;
let connected = false;
let phone: string | null = null;
/** Extra self JIDs (LID + PN) seen for Message-yourself matching — owner only. */
const selfJidAliases = new Set<string>();
/** PN ↔ LID aliases for allowlist matching (any contact). */
const lidToPn = new Map<string, string>();
const pnToLid = new Map<string, string>();
/** Recent messages for Baileys decrypt retries (getMessage). */
const recentMessages = new Map<string, WAMessage>();
const RECENT_MSG_LIMIT = 200;
let lastError: string | null = null;
let messagesSeen = 0;
let repliesSent = 0;
let lastMessageAt: number | null = null;
let lastReplyAt: number | null = null;

function isUserJid(id: string): boolean {
  return id.endsWith("@s.whatsapp.net") || id.endsWith("@lid");
}

function bareUser(id: string): string {
  return jidNormalizedUser(id).split("@")[0]?.split(":")[0] ?? "";
}

function rememberPnLidPair(lid?: string | null, pn?: string | null): void {
  const lidId = String(lid ?? "").trim();
  const pnId = String(pn ?? "").trim();
  if (!lidId || !pnId) return;
  if (!lidId.includes("@lid") || !pnId.includes("@s.whatsapp.net")) return;
  const lidN = jidNormalizedUser(lidId);
  const pnN = jidNormalizedUser(pnId);
  lidToPn.set(lidN, pnN);
  pnToLid.set(pnN, lidN);
  // Only treat as self when the PN matches our linked phone
  const digits = phone?.replace(/\D/g, "") ?? "";
  if (digits && bareUser(pnN) === digits) {
    rememberSelfJid(lidN);
    rememberSelfJid(pnN);
  }
}

function msgCacheKey(jid: string | null | undefined, id: string | null | undefined): string | null {
  if (!jid || !id) return null;
  return `${jid}|${id}`;
}

function cacheMessage(msg: WAMessage): void {
  const key = msgCacheKey(msg.key.remoteJid, msg.key.id);
  if (!key || !msg.message) return;
  recentMessages.set(key, msg);
  if (recentMessages.size > RECENT_MSG_LIMIT) {
    const first = recentMessages.keys().next().value;
    if (first) recentMessages.delete(first);
  }
}

function allowlistAliases(chatId: string): string[] {
  const id = chatId.trim();
  if (!id) return [];
  const out = new Set<string>([id, jidNormalizedUser(id)]);
  const norm = jidNormalizedUser(id);
  const asPn = lidToPn.get(norm);
  const asLid = pnToLid.get(norm);
  if (asPn) {
    out.add(asPn);
    out.add(jidNormalizedUser(asPn));
  }
  if (asLid) {
    out.add(asLid);
    out.add(jidNormalizedUser(asLid));
  }
  return [...out];
}

export type WhatsAppStatus = {
  configured: boolean;
  ready: boolean;
  paused: boolean;
  phone: string | null;
  qrDataUrl: string | null;
  qrUpdatedAt: number | null;
  qrAgeSec: number | null;
  allowlist: string[];
  knownGroups: Array<{ id: string; name: string; about?: string; lastSeenAt: number; allowed: boolean }>;
  knownChats: Array<{ id: string; name: string; about?: string; lastSeenAt: number; allowed: boolean; self?: boolean }>;
  messagesSeen: number;
  repliesSent: number;
  lastMessageAt: number | null;
  lastReplyAt: number | null;
  lastError: string | null;
};

function humanWhatsAppError(raw: string | null): string | null {
  if (!raw) return null;
  const t = raw.toLowerCase();
  if (t.includes("qr refs") || t.includes("timed out") || t.includes("timeout")) {
    return "QR expired before a successful scan. Keep the WhatsApp tab open (it auto-refreshes) and scan within ~20 seconds of a new code.";
  }
  if (t.includes("logged out") || t.includes("401")) {
    return "WhatsApp logged this device out. Scan a new QR.";
  }
  if (t.includes("conflict") || t.includes("replaced")) {
    return "Another session replaced this link. Unlink extras on your phone or scan again.";
  }
  return raw;
}

export function whatsappStatus(): WhatsAppStatus {
  const settings = getWhatsAppSettings();
  const allowed = new Set(settings.allowlist);
  const qrAgeSec = qrUpdatedAt && !connected ? Math.max(0, Math.floor((Date.now() - qrUpdatedAt) / 1000)) : null;
  const selfDigits = phone?.replace(/\D/g, "") ?? "";
  const selfId = selfDigits.length >= 8 ? `${selfDigits}@s.whatsapp.net` : "";

  const mapChat = (c: { id: string; name: string; about?: string; lastSeenAt: number }) => ({
    ...c,
    about: c.about,
    allowed: allowed.has(c.id),
    self: Boolean(selfId && c.id === selfId),
  });

  // Hide duplicate LID "self" rows; keep the phone JID entry only
  const chats = settings.knownChats
    .filter((c) => !(selfDigits && c.name.startsWith("You (Message yourself)") && c.id !== selfId))
    .map(mapChat);
  chats.sort((a, b) => Number(b.self) - Number(a.self) || b.lastSeenAt - a.lastSeenAt);

  return {
    configured: existsSync(join(authDir, "creds.json")) || connected,
    ready: connected,
    paused: settings.paused,
    phone,
    qrDataUrl: connected ? null : qrDataUrl,
    qrUpdatedAt: connected ? null : qrUpdatedAt,
    qrAgeSec,
    allowlist: [...settings.allowlist],
    knownGroups: settings.knownGroups.map((g) => ({
      ...g,
      about: g.about,
      allowed: allowed.has(g.id),
    })),
    knownChats: chats,
    messagesSeen,
    repliesSent,
    lastMessageAt,
    lastReplyAt,
    lastError: humanWhatsAppError(lastError),
  };
}

export function getWhatsAppSocket(): WASocket | undefined {
  return sock;
}

/** JIDs for the linked WhatsApp account (owner phone CamelBot shares). */
export function getWhatsAppSelfJids(): string[] {
  const out = new Set<string>(selfJidAliases);
  const u = sock?.user;
  if (u?.id) {
    out.add(u.id);
    out.add(jidNormalizedUser(u.id));
  }
  const lid = (u as { lid?: string } | undefined)?.lid;
  if (lid) {
    out.add(lid);
    out.add(jidNormalizedUser(lid));
  }
  if (phone) {
    out.add(`${phone}@s.whatsapp.net`);
  }
  return [...out];
}

function rememberSelfJid(jid: string | null | undefined): void {
  const id = String(jid ?? "").trim();
  if (!id || !isUserJid(id)) return;
  if (id.includes("status") || id.includes("broadcast") || id.includes("newsletter")) return;
  selfJidAliases.add(id);
  selfJidAliases.add(jidNormalizedUser(id));
}

/** True for the linked account's "Message yourself" chat (PN or LID). */
export function isWhatsAppSelfChat(chatId: string): boolean {
  const id = chatId.trim();
  if (!id || !isUserJid(id)) return false;
  for (const self of getWhatsAppSelfJids()) {
    try {
      if (areJidsSameUser(self, id) || self === id || jidNormalizedUser(self) === jidNormalizedUser(id)) {
        return true;
      }
    } catch {
      if (self === id || jidNormalizedUser(self) === jidNormalizedUser(id)) return true;
    }
  }
  const digits = phone?.replace(/\D/g, "") ?? "";
  if (digits.length >= 8 && bareUser(id) === digits) return true;
  // LID mapped to our phone
  const pn = lidToPn.get(jidNormalizedUser(id));
  if (pn && digits && bareUser(pn) === digits) return true;
  return false;
}

/** Allowlist check that also matches PN↔LID aliases and self-chat. */
export function chatIsAllowlisted(chatId: string): boolean {
  const candidates = allowlistAliases(chatId);
  for (const c of candidates) {
    if (isAllowlisted(c)) return true;
  }
  const settings = getWhatsAppSettings();
  for (const id of settings.allowlist) {
    const allowedAliases = allowlistAliases(id);
    for (const c of candidates) {
      for (const a of allowedAliases) {
        try {
          if (areJidsSameUser(a, c) || a === c || jidNormalizedUser(a) === jidNormalizedUser(c)) {
            return true;
          }
        } catch {
          if (a === c || jidNormalizedUser(a) === jidNormalizedUser(c)) return true;
        }
      }
    }
    // Allowlisted "Message yourself" covers any self JID (PN or LID)
    if (isWhatsAppSelfChat(id) && isWhatsAppSelfChat(chatId)) return true;
  }
  return false;
}

export function noteWhatsAppReply(): void {
  repliesSent += 1;
  lastReplyAt = Date.now();
}

export function noteWhatsAppSeen(): void {
  messagesSeen += 1;
  lastMessageAt = Date.now();
}

export async function startWhatsApp(): Promise<void> {
  if (starting || sock) return;
  starting = true;
  try {
    await connectWhatsApp();
  } finally {
    starting = false;
  }
}

async function connectWhatsApp(): Promise<void> {
  mkdirSync(authDir, { recursive: true });
  reloadWhatsAppSettings();

  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  const socket = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    logger,
    browser: Browsers.macOS("Desktop"),
    syncFullHistory: false,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false,
    connectTimeoutMs: 60_000,
    qrTimeout: 40_000,
    getMessage: async (key) => {
      const cached = recentMessages.get(msgCacheKey(key.remoteJid, key.id) ?? "");
      return cached?.message ?? undefined;
    },
  });
  sock = socket;

  socket.ev.on("creds.update", saveCreds);

  socket.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      void QRCode.toDataURL(qr, { margin: 1, width: 280, errorCorrectionLevel: "M" })
        .then((url) => {
          qrDataUrl = url;
          qrUpdatedAt = Date.now();
          connected = false;
          lastError = null;
          console.log("[whatsapp] QR ready — scan within ~20s (Dashboard auto-refreshes)");
        })
        .catch((err) => {
          lastError = err instanceof Error ? err.message : String(err);
          console.warn("[whatsapp] QR encode failed", err);
        });
    }
    if (connection === "open") {
      connected = true;
      qrDataUrl = null;
      qrUpdatedAt = null;
      lastError = null;
      const me = socket.user?.id ? jidNormalizedUser(socket.user.id) : null;
      phone = me ? me.split("@")[0]?.split(":")[0] ?? null : null;
      rememberSelfJid(socket.user?.id);
      rememberSelfJid((socket.user as { lid?: string } | undefined)?.lid);
      if (phone) rememberSelfJid(`${phone}@s.whatsapp.net`);
      botOk("whatsapp", phone ? `Linked +${phone}` : "Linked");
      console.log(
        `[whatsapp] connected${phone ? ` as +${phone}` : ""} selfJids=${getWhatsAppSelfJids().join(",")}`,
      );
      void refreshWhatsAppDirectory().catch((err) => {
        console.warn("[whatsapp] directory sync failed", err);
      });
    }
    if (connection === "close") {
      connected = false;
      const boom = lastDisconnect?.error as Boom | undefined;
      const statusCode = boom?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      const reason = boom?.message || `code ${statusCode ?? "?"}`;
      lastError = reason;
      sock = undefined;
      console.warn(`[whatsapp] disconnected: ${reason} (status=${statusCode ?? "?"})`);
      if (loggedOut) {
        qrDataUrl = null;
        qrUpdatedAt = null;
        phone = null;
        botFail("whatsapp", "Logged out — scan QR again");
        clearAuthFiles();
        scheduleRestart(1500);
        return;
      }
      // QR timeout / refs ended — clear stale image so UI does not show a dead code
      if (
        statusCode === DisconnectReason.timedOut ||
        /qr refs/i.test(reason) ||
        statusCode === DisconnectReason.restartRequired
      ) {
        qrDataUrl = null;
        qrUpdatedAt = null;
      }
      scheduleRestart(2000);
    }
  });

  socket.ev.on("messages.upsert", ({ messages, type }) => {
    for (const msg of messages) {
      cacheMessage(msg);
      const preview = extractWhatsAppText(msg).slice(0, 60);
      console.log(
        `[whatsapp] upsert type=${type} fromMe=${Boolean(msg.key.fromMe)} jid=${msg.key.remoteJid ?? "?"} text=${JSON.stringify(preview)}`,
      );
      // Old history sync — discover chats, do not AI-reply. Fresh appends (incl. phone → linked) still process.
      if (type === "append" && !msg.key.fromMe && messageAgeMs(msg) > 90_000) {
        const chatId = msg.key.remoteJid;
        if (chatId && isJidGroup(chatId)) rememberWhatsAppGroup(chatId);
        else if (chatId) rememberWhatsAppChat(chatId, msg.pushName || undefined);
        continue;
      }
      void enqueueWork(`wa:${msg.key.remoteJid ?? "x"}`, () => onInbound(socket, msg, type)).catch((err) => {
        lastError = err instanceof Error ? err.message : String(err);
        console.warn("[whatsapp] message handler", err);
      });
    }
  });

  socket.ev.on("lid-mapping.update", (mapping) => {
    const row = mapping as { lid?: string; pn?: string } | Array<{ lid?: string; pn?: string }>;
    const rows = Array.isArray(row) ? row : [row];
    for (const m of rows) rememberPnLidPair(m.lid, m.pn);
  });

  socket.ev.on("groups.update", (updates) => {
    for (const u of updates) {
      if (u.id && u.subject) rememberWhatsAppGroup(u.id, u.subject);
    }
  });

  socket.ev.on("groups.upsert", (groups) => {
    rememberWhatsAppMany(
      groups.map((g) => ({ id: g.id, name: g.subject || g.id })),
      [],
    );
  });

  socket.ev.on("chats.upsert", (chats) => {
    const groups: Array<{ id: string; name?: string }> = [];
    const dms: Array<{ id: string; name?: string }> = [];
    for (const chat of chats) {
      const id = String(chat.id ?? "").trim();
      if (!id) continue;
      const name = String(chat.name ?? "").trim() || undefined;
      if (isJidGroup(id)) groups.push({ id, name });
      else dms.push({ id, name });
    }
    rememberWhatsAppMany(groups, dms);
  });

  socket.ev.on("contacts.upsert", (contacts) => {
    rememberWhatsAppMany(
      [],
      contacts.map((c) => {
        const id = String(c.id ?? "").trim();
        const name =
          String(c.notify ?? c.name ?? c.verifiedName ?? "").trim() ||
          id.split("@")[0]?.split(":")[0] ||
          id;
        return { id, name };
      }),
    );
  });

  socket.ev.on("messaging-history.set", ({ chats, contacts }) => {
    const groups: Array<{ id: string; name?: string }> = [];
    const dms: Array<{ id: string; name?: string }> = [];
    for (const chat of chats) {
      const id = String(chat.id ?? "").trim();
      if (!id) continue;
      const name = String(chat.name ?? "").trim() || undefined;
      if (isJidGroup(id)) groups.push({ id, name });
      else dms.push({ id, name });
    }
    for (const c of contacts) {
      const id = String(c.id ?? "").trim();
      if (!id || isJidGroup(id)) continue;
      const name =
        String(c.notify ?? c.name ?? c.verifiedName ?? "").trim() ||
        id.split("@")[0]?.split(":")[0] ||
        id;
      dms.push({ id, name });
    }
    rememberWhatsAppMany(groups, dms);
    console.log(`[whatsapp] history sync: ${groups.length} group chats, ${dms.length} DMs in chunk`);
  });
}

/** Pull participating groups (+ any cached contacts) into Dashboard lists. */
export async function refreshWhatsAppDirectory(): Promise<{ groups: number; chats: number }> {
  const socket = sock;
  if (!socket || !connected) {
    ensureSelfChat(phone, getWhatsAppSelfJids());
    return {
      groups: getWhatsAppSettings().knownGroups.length,
      chats: getWhatsAppSettings().knownChats.length,
    };
  }
  try {
    const all = await socket.groupFetchAllParticipating();
    const groups = Object.values(all).map((g) => ({
      id: g.id,
      name: g.subject || g.id,
      about: String(g.desc ?? "").trim() || undefined,
    }));
    rememberWhatsAppMany(groups, []);
    console.log(`[whatsapp] loaded ${groups.length} participating group(s)`);
  } catch (err) {
    console.warn("[whatsapp] groupFetchAllParticipating failed", err);
    lastError = err instanceof Error ? err.message : String(err);
  }
  ensureSelfChat(phone, getWhatsAppSelfJids());
  const s = getWhatsAppSettings();
  return { groups: s.knownGroups.length, chats: s.knownChats.length };
}

const recentOutbound = new Map<string, number>();
const OUTBOUND_TTL_MS = 20_000;

function rememberOutbound(chatId: string, text: string): void {
  const key = `${chatId}::${text.slice(0, 240)}`;
  recentOutbound.set(key, Date.now());
  if (recentOutbound.size > 40) {
    const now = Date.now();
    for (const [k, at] of recentOutbound) {
      if (now - at > OUTBOUND_TTL_MS) recentOutbound.delete(k);
    }
  }
}

function isRecentOutbound(chatId: string, text: string): boolean {
  const key = `${chatId}::${text.slice(0, 240)}`;
  const at = recentOutbound.get(key);
  if (!at) return false;
  if (Date.now() - at > OUTBOUND_TTL_MS) {
    recentOutbound.delete(key);
    return false;
  }
  return true;
}

function messageAgeMs(msg: WAMessage): number {
  const raw = msg.messageTimestamp;
  if (raw == null) return 0;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const ms = n > 1e12 ? n : n * 1000;
  return Math.max(0, Date.now() - ms);
}

async function onInbound(socket: WASocket, msg: WAMessage, upsertType?: string): Promise<void> {
  if (!msg.message) return;
  const chatId = msg.key.remoteJid;
  if (!chatId) return;
  if (isJidStatusBroadcast(chatId) || isJidBroadcast(chatId) || isJidNewsletter(chatId)) return;

  // Own sends: only process Message-yourself, or when you trigger the bot
  // inside an allowlisted group/DM (so "bot naber" from your phone still works).
  if (msg.key.fromMe) {
    if (isUserJid(chatId) && isWhatsAppSelfChat(chatId)) {
      rememberSelfJid(chatId);
    }
    const allowedOwn =
      isWhatsAppSelfChat(chatId) || (chatIsAllowlisted(chatId) && (isJidGroup(chatId) || isUserJid(chatId)));
    if (!allowedOwn) {
      console.log(`[whatsapp] skip fromMe jid=${chatId}`);
      return;
    }
  }

  if (isJidGroup(chatId)) {
    try {
      const meta = await socket.groupMetadata(chatId);
      rememberWhatsAppGroup(chatId, meta.subject, String(meta.desc ?? "").trim() || undefined);
    } catch {
      rememberWhatsAppGroup(chatId);
    }
  } else if (!msg.key.fromMe) {
    rememberWhatsAppChat(chatId, msg.pushName || undefined);
  }

  const text = extractWhatsAppText(msg);
  if (msg.key.fromMe && text && isRecentOutbound(chatId, text)) {
    console.log(`[whatsapp] skip own outbound echo jid=${chatId}`);
    return;
  }
  // Don't treat our dashboard test line as a user prompt
  if (msg.key.fromMe && /^CamelBot WhatsApp test/i.test(text)) return;

  if (upsertType && upsertType !== "notify" && upsertType !== "append") {
    console.log(`[whatsapp] skip upsert type=${upsertType} jid=${chatId}`);
    return;
  }

  const { handleWhatsAppMessage } = await import("./router.js");
  await handleWhatsAppMessage(socket, msg);
}

function scheduleRestart(ms: number): void {
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restartTimer = undefined;
    void startWhatsApp().catch((err) => {
      lastError = err instanceof Error ? err.message : String(err);
      console.warn("[whatsapp] restart failed", err);
      scheduleRestart(8000);
    });
  }, ms);
}

function clearAuthFiles(): void {
  try {
    if (existsSync(authDir)) rmSync(authDir, { recursive: true, force: true });
  } catch (err) {
    console.warn("[whatsapp] could not clear auth", err);
  }
}

export async function unlinkWhatsApp(): Promise<void> {
  try {
    if (sock) {
      await sock.logout().catch(() => undefined);
      sock.end(undefined);
    }
  } catch {
    /* ignore */
  }
  sock = undefined;
  connected = false;
  phone = null;
  qrDataUrl = null;
  qrUpdatedAt = null;
  clearAuthFiles();
  botThink("whatsapp", "Unlinked — waiting for new QR");
  scheduleRestart(800);
}

export async function sendWhatsAppText(chatId: string, text: string): Promise<boolean> {
  const clipped = stripKickEmoteTokens(text).replace(/\s+/g, " ").trim().slice(0, 3500);
  if (!clipped) return false;
  if (!chatIsAllowlisted(chatId)) {
    lastError = "Refused: chat is not on the WhatsApp allowlist";
    return false;
  }
  if (!sock || !connected) {
    lastError = "WhatsApp is not connected";
    return false;
  }
  rememberOutbound(chatId, clipped);
  await sock.sendMessage(chatId, { text: clipped });
  noteWhatsAppReply();
  return true;
}

/** Send an image (JPEG/PNG/WebP) to an allowlisted chat. */
export async function sendWhatsAppImage(
  chatId: string,
  image: Buffer,
  opts?: { caption?: string; mime?: string },
): Promise<boolean> {
  if (!image?.length) {
    lastError = "Empty image";
    return false;
  }
  if (!chatIsAllowlisted(chatId)) {
    lastError = "Refused: chat is not on the WhatsApp allowlist";
    return false;
  }
  if (!sock || !connected) {
    lastError = "WhatsApp is not connected";
    return false;
  }
  const caption = stripKickEmoteTokens(opts?.caption ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1000);
  if (caption) rememberOutbound(chatId, caption);
  await sock.sendMessage(chatId, {
    image,
    caption: caption || undefined,
    mimetype: opts?.mime || "image/jpeg",
  });
  noteWhatsAppReply();
  return true;
}

export async function sendWhatsAppTest(chatId: string): Promise<{ ok: boolean; error?: string }> {
  const ok = await sendWhatsAppText(chatId, "CamelBot WhatsApp test — allowlist works.");
  return ok ? { ok: true } : { ok: false, error: lastError ?? "Send failed" };
}

/** Stable numeric key for memory / AI history (phone digits or hash). */
export function waUserKey(jid: string): number {
  const bare = jidNormalizedUser(jid).split("@")[0]?.split(":")[0] ?? jid;
  const digits = bare.replace(/\D/g, "");
  if (digits.length >= 8) {
    const n = Number(digits.slice(-12));
    if (Number.isSafeInteger(n) && n > 0) return n;
  }
  let h = 0;
  for (let i = 0; i < jid.length; i++) h = (Math.imul(31, h) + jid.charCodeAt(i)) | 0;
  return Math.abs(h) || 1;
}

export function extractWhatsAppText(msg: WAMessage): string {
  const content = msg.message;
  if (!content) return "";
  const type = getContentType(content);
  if (!type) return "";
  const node = content[type] as
    | { text?: string; caption?: string; conversation?: string; selectedDisplayText?: string }
    | string
    | undefined;
  if (typeof node === "string") return node.trim();
  if (!node || typeof node !== "object") {
    if (content.conversation) return content.conversation.trim();
    return "";
  }
  const text =
    node.text ||
    node.caption ||
    node.conversation ||
    node.selectedDisplayText ||
    content.conversation ||
    "";
  return String(text).trim();
}
