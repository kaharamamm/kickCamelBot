import { listCommandTimers } from "./commandTimers.js";
import { runScheduledCommand } from "./commands.js";
import { channelLiveStatus } from "./liveState.js";
import { say } from "./outbox.js";
import { listTimedCommands } from "./timedStore.js";

type HomeRef = { slug: string; broadcasterUserId: number };

let home: HomeRef | undefined;
let timers: ReturnType<typeof setInterval>[] = [];
const lastSent = new Map<string, number>();

export function startTimedCommands(next: HomeRef): void {
  stopTimedCommands();
  home = next;
  lastSent.clear();
  const now = Date.now();
  for (const row of listTimedCommands()) {
    if (!row.enabled || row.minutes < 1) continue;
    lastSent.set(`msg:${row.id}`, now);
    timers.push(setInterval(() => void tickMessage(row.id), 30_000));
  }
  for (const row of listCommandTimers()) {
    lastSent.set(`cmd:${row.name}`, now);
    timers.push(setInterval(() => void tickCommand(row.name), 30_000));
  }
  console.log(`[timed] ${timers.length} timer(s) on ${next.slug}`);
}

export function restartTimedCommands(): void {
  if (home) startTimedCommands(home);
}

export function stopTimedCommands(): void {
  for (const t of timers) clearInterval(t);
  timers = [];
}

async function tickMessage(id: string): Promise<void> {
  if (!home) return;
  const row = listTimedCommands().find((c) => c.id === id);
  if (!row?.enabled || row.minutes < 1) return;
  if (!due(`msg:${id}`, row.minutes)) return;
  if (!(await liveOk())) return;
  lastSent.set(`msg:${id}`, Date.now());
  await say(row.text, undefined, home.broadcasterUserId);
}

async function tickCommand(name: string): Promise<void> {
  if (!home) return;
  const minutes = listCommandTimers().find((c) => c.name === name)?.minutes;
  if (!minutes) return;
  if (!due(`cmd:${name}`, minutes)) return;
  if (!(await liveOk())) return;
  const line = await runScheduledCommand(name);
  if (!line) return;
  lastSent.set(`cmd:${name}`, Date.now());
  await say(line, undefined, home.broadcasterUserId);
}

function due(key: string, minutes: number): boolean {
  return Date.now() - (lastSent.get(key) ?? 0) >= Math.max(60_000, minutes * 60_000);
}

async function liveOk(): Promise<boolean> {
  if (!home) return false;
  const status = await channelLiveStatus(home.slug, home.broadcasterUserId);
  return status.chatterOk;
}
