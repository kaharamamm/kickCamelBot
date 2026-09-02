import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";

const path = join(fileURLToPath(new URL(".", import.meta.url)), "../../data/channels.json");

export type SavedChannel = {
  slug: string;
  userId?: number;
  chatroomId?: number;
};

type Store = { extra: SavedChannel[] };

function readStore(): Store {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { extra?: unknown };
    if (Array.isArray(parsed.extra)) {
      return { extra: unique(parsed.extra.map(asSaved).filter((c): c is SavedChannel => Boolean(c))) };
    }
  } catch {
    // first run: seed from .env
  }
  return {
    extra: unique(config.bot.extraChannels.map((slug) => ({ slug }))),
  };
}

function writeStore(store: Store): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ extra: unique(store.extra) }, null, 2));
}

export function extraChannels(): SavedChannel[] {
  try {
    readFileSync(path, "utf8");
    return readStore().extra;
  } catch {
    const seeded = unique(config.bot.extraChannels.map((slug) => ({ slug })));
    writeStore({ extra: seeded });
    return seeded;
  }
}

export function extraChannelSlugs(): string[] {
  return extraChannels().map((c) => c.slug);
}

export function parseChannelSlug(input: string): string | null {
  const raw = input.trim().toLowerCase();
  if (!raw) return null;
  try {
    if (raw.includes("kick.com")) {
      const url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
      const slug = url.pathname.split("/").filter(Boolean)[0] ?? "";
      return validSlug(slug);
    }
  } catch {
    return null;
  }
  return validSlug(raw.replace(/^@/, ""));
}

export function addChannel(channel: SavedChannel): SavedChannel {
  const slug = validSlug(channel.slug);
  if (!slug) throw new Error("Enter a Kick username or URL");
  const store = readStore();
  const next: SavedChannel = { slug, userId: channel.userId, chatroomId: channel.chatroomId };
  const index = store.extra.findIndex((c) => c.slug === slug);
  if (index >= 0) store.extra[index] = { ...store.extra[index], ...next };
  else store.extra.push(next);
  writeStore(store);
  return next;
}

export function rememberChannelMeta(slug: string, userId: number, chatroomId: number): void {
  const store = readStore();
  const index = store.extra.findIndex((c) => c.slug === slug.toLowerCase());
  if (index < 0) return;
  store.extra[index] = { ...store.extra[index], slug: slug.toLowerCase(), userId, chatroomId };
  writeStore(store);
}

export function removeChannelSlug(slug: string): void {
  const store = readStore();
  store.extra = store.extra.filter((s) => s.slug !== slug.toLowerCase());
  writeStore(store);
}

function asSaved(value: unknown): SavedChannel | null {
  if (typeof value === "string") return { slug: value.toLowerCase() };
  if (value && typeof value === "object" && "slug" in value && typeof (value as SavedChannel).slug === "string") {
    const row = value as SavedChannel;
    return { slug: row.slug.toLowerCase(), userId: row.userId, chatroomId: row.chatroomId };
  }
  return null;
}

function validSlug(slug: string): string | null {
  if (!/^[a-z0-9_-]{3,25}$/.test(slug)) return null;
  return slug;
}

function unique(values: SavedChannel[]): SavedChannel[] {
  const seen = new Set<string>();
  const out: SavedChannel[] = [];
  for (const row of values) {
    const slug = row.slug.trim().toLowerCase();
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push({ ...row, slug });
  }
  return out;
}
