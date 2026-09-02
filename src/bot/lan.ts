import { join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";

const tunnelFile = join(fileURLToPath(new URL(".", import.meta.url)), "../../data/tunnel-url.txt");

export function lanUrls(port: number): string[] {
  const urls: string[] = [];
  for (const addrs of Object.values(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      const v4 = addr.family === "IPv4" || (addr.family as unknown) === 4;
      if (!v4 || addr.internal) continue;
      urls.push(`http://${addr.address}:${port}`);
    }
  }
  return urls;
}

export function tunnelBaseUrl(): string | null {
  try {
    const raw = readFileSync(tunnelFile, "utf8").trim();
    const m = raw.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
    return m?.[0] ?? (raw.startsWith("https://") ? raw.replace(/\/$/, "") : null);
  } catch {
    return null;
  }
}

export function isPrivateDashboardHost(host: string): boolean {
  const h = host.split(":")[0]?.toLowerCase() ?? "";
  if (!h || h === "localhost" || h === "127.0.0.1" || h === "::1") return true;
  if (/^192\.168\.\d+\.\d+$/.test(h)) return true;
  if (/^10\.\d+\.\d+\.\d+$/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(h)) return true;
  return false;
}
