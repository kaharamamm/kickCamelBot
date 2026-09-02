import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const lockPath = join(fileURLToPath(new URL(".", import.meta.url)), "../../data/instance.pid");

function pidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function waitMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function claimInstance(): void {
  mkdirSync(dirname(lockPath), { recursive: true });
  if (existsSync(lockPath)) {
    const old = Number(readFileSync(lockPath, "utf8").trim());
    if (pidAlive(old)) {
      waitMs(2000);
      if (pidAlive(old)) {
        console.error(`[CamelBot] already running as pid ${old}. Stop that copy, then start this one.`);
        process.exit(1);
      }
    }
  }
  writeFileSync(lockPath, String(process.pid));
  const release = (): void => {
    try {
      if (readFileSync(lockPath, "utf8").trim() === String(process.pid)) unlinkSync(lockPath);
    } catch {
      // ignore
    }
  };
  process.on("exit", release);
  process.on("SIGINT", () => {
    release();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    release();
    process.exit(0);
  });
}
