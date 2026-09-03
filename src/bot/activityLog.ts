export type ActivityLevel = "info" | "think" | "ok" | "fail" | "warn";

export type ActivityEntry = {
  id: string;
  at: number;
  level: ActivityLevel;
  source: string;
  text: string;
};

const MAX = 300;
const entries: ActivityEntry[] = [];
const listeners = new Set<(entry: ActivityEntry) => void>();
let seq = 0;

export function botLog(level: ActivityLevel, source: string, text: string): ActivityEntry {
  const entry: ActivityEntry = {
    id: `${Date.now()}-${++seq}`,
    at: Date.now(),
    level,
    source: source.slice(0, 40),
    text: text.replace(/\s+/g, " ").trim().slice(0, 500),
  };
  entries.push(entry);
  if (entries.length > MAX) entries.splice(0, entries.length - MAX);
  for (const fn of listeners) {
    try {
      fn(entry);
    } catch {
      /* ignore subscriber errors */
    }
  }
  const tag = level === "fail" ? "error" : level === "warn" ? "warn" : "log";
  console[tag === "error" ? "warn" : tag === "warn" ? "warn" : "log"](`[${source}] ${entry.text}`);
  return entry;
}

export function botInfo(source: string, text: string): void {
  botLog("info", source, text);
}

export function botThink(source: string, text: string): void {
  botLog("think", source, text);
}

export function botOk(source: string, text: string): void {
  botLog("ok", source, text);
}

export function botFail(source: string, text: string): void {
  botLog("fail", source, text);
}

export function botWarn(source: string, text: string): void {
  botLog("warn", source, text);
}

export function activityHistory(limit = 200): ActivityEntry[] {
  const n = Math.max(1, Math.min(MAX, limit));
  return entries.slice(-n);
}

export function activitySince(afterId: string | null | undefined): ActivityEntry[] {
  if (!afterId) return activityHistory();
  const idx = entries.findIndex((e) => e.id === afterId);
  if (idx < 0) return activityHistory();
  return entries.slice(idx + 1);
}

export function clearActivityLog(): ActivityEntry[] {
  entries.length = 0;
  return entries;
}

export function subscribeActivity(fn: (entry: ActivityEntry) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
