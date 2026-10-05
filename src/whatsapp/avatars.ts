import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getWhatsAppSocket } from "./client.js";

const avatarDir = join(fileURLToPath(new URL(".", import.meta.url)), "../../data/whatsapp-avatars");
const CACHE_MS = 6 * 60 * 60 * 1000; // 6h

type Meta = { at: number; empty?: boolean; ext?: string };

const memory = new Map<string, { buf: Buffer; ctype: string; at: number } | { empty: true; at: number }>();

function safeKey(jid: string): string {
  return createHash("sha1").update(jid).digest("hex").slice(0, 24);
}

function metaPath(key: string): string {
  return join(avatarDir, `${key}.json`);
}

function filePath(key: string, ext: string): string {
  return join(avatarDir, `${key}.${ext}`);
}

function readMeta(key: string): Meta | null {
  try {
    if (!existsSync(metaPath(key))) return null;
    return JSON.parse(readFileSync(metaPath(key), "utf8")) as Meta;
  } catch {
    return null;
  }
}

function writeMeta(key: string, meta: Meta): void {
  mkdirSync(avatarDir, { recursive: true });
  writeFileSync(metaPath(key), JSON.stringify(meta));
}

function guessExt(ctype: string, url: string): string {
  if (ctype.includes("png")) return "png";
  if (ctype.includes("webp")) return "webp";
  if (ctype.includes("gif")) return "gif";
  if (url.includes(".png")) return "png";
  if (url.includes(".webp")) return "webp";
  return "jpg";
}

/** Fetch (or return cached) profile picture bytes for a WhatsApp JID. */
export async function getWhatsAppAvatar(
  jid: string,
): Promise<{ buf: Buffer; contentType: string } | null> {
  const id = jid.trim();
  if (!id || !id.includes("@")) return null;
  const key = safeKey(id);
  const now = Date.now();

  const mem = memory.get(key);
  if (mem) {
    if ("empty" in mem) {
      if (now - mem.at < CACHE_MS) return null;
    } else if (now - mem.at < CACHE_MS) {
      return { buf: mem.buf, contentType: mem.ctype };
    }
  }

  const meta = readMeta(key);
  if (meta && now - meta.at < CACHE_MS) {
    if (meta.empty) {
      memory.set(key, { empty: true, at: meta.at });
      return null;
    }
    const ext = meta.ext || "jpg";
    const fp = filePath(key, ext);
    if (existsSync(fp)) {
      const buf = readFileSync(fp);
      const ctype =
        ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "gif" ? "image/gif" : "image/jpeg";
      memory.set(key, { buf, ctype, at: meta.at });
      return { buf, contentType: ctype };
    }
  }

  const socket = getWhatsAppSocket();
  if (!socket) return null;

  try {
    const url = await socket.profilePictureUrl(id, "preview");
    if (!url) {
      writeMeta(key, { at: now, empty: true });
      memory.set(key, { empty: true, at: now });
      return null;
    }
    const res = await fetch(url);
    if (!res.ok) {
      writeMeta(key, { at: now, empty: true });
      memory.set(key, { empty: true, at: now });
      return null;
    }
    const ctype = res.headers.get("content-type") || "image/jpeg";
    const buf = Buffer.from(await res.arrayBuffer());
    const ext = guessExt(ctype, url);
    mkdirSync(avatarDir, { recursive: true });
    writeFileSync(filePath(key, ext), buf);
    writeMeta(key, { at: now, ext });
    memory.set(key, { buf, ctype, at: now });
    return { buf, contentType: ctype };
  } catch {
    writeMeta(key, { at: now, empty: true });
    memory.set(key, { empty: true, at: now });
    return null;
  }
}

/** Dashboard img src — lazy-loads through the avatar proxy. */
export function whatsappAvatarSrc(jid: string): string {
  return `/whatsapp/avatar?jid=${encodeURIComponent(jid)}`;
}

/** Initials for placeholder avatar. */
export function whatsappInitials(name: string): string {
  const clean = name.replace(/[^\p{L}\p{N}\s]/gu, " ").trim();
  if (!clean) return "?";
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase().slice(0, 2);
  }
  return clean.slice(0, 2).toUpperCase();
}

/** Stable WhatsApp-like avatar color from id/name. */
export function whatsappAvatarColor(seed: string): string {
  const colors = [
    "#00a884",
    "#53bdeb",
    "#06cf9c",
    "#a855f7",
    "#f59e0b",
    "#ef4444",
    "#3b82f6",
    "#ec4899",
    "#14b8a6",
    "#8b5cf6",
  ];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  return colors[Math.abs(h) % colors.length]!;
}
