import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TokenSet } from "../types.js";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "../..");
const tokenPath = join(root, "data", "tokens.json");
const botTokenPath = join(root, "data", "bot-tokens.json");

function readTokenFile(path: string): TokenSet | null {
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as TokenSet;
    if (!parsed.accessToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function loadTokens(): TokenSet | null {
  return readTokenFile(tokenPath);
}

export function loadBotTokens(): TokenSet | null {
  return readTokenFile(botTokenPath);
}

export function saveTokens(tokens: TokenSet): void {
  mkdirSync(dirname(tokenPath), { recursive: true });
  writeFileSync(tokenPath, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

export function saveBotTokens(tokens: TokenSet): void {
  mkdirSync(dirname(botTokenPath), { recursive: true });
  writeFileSync(botTokenPath, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

export function clearTokens(): void {
  try {
    writeFileSync(tokenPath, "{}\n", { mode: 0o600 });
  } catch {
    // ignore
  }
}
