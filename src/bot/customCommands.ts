import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AccessLevel } from "./access.js";

const path = join(fileURLToPath(new URL(".", import.meta.url)), "../../data/commands.json");

export type CustomCommand = {
  name: string;
  response: string;
  who: AccessLevel;
};

function asWho(value: unknown): AccessLevel {
  if (value === "mods" || value === "broadcaster" || value === "everyone") return value;
  return "everyone";
}

function readAll(): CustomCommand[] {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { commands?: Array<Partial<CustomCommand>> };
    if (!Array.isArray(parsed.commands)) return [];
    return parsed.commands
      .filter((c) => c?.name && c?.response)
      .map((c) => ({ name: String(c.name), response: String(c.response), who: asWho(c.who) }));
  } catch {
    return [];
  }
}

function writeAll(commands: CustomCommand[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ commands }, null, 2));
}

export function listCustomCommands(): CustomCommand[] {
  return readAll().sort((a, b) => a.name.localeCompare(b.name));
}

export function getCustomCommand(name: string): CustomCommand | undefined {
  const key = normalizeName(name);
  return readAll().find((c) => c.name === key);
}

export function addCustomCommand(name: string, response: string, who: AccessLevel = "everyone"): CustomCommand {
  const cmd = normalizeName(name);
  const text = response.replace(/\s+/g, " ").trim();
  if (!cmd) throw new Error("Command name is empty");
  if (!/^[a-z0-9_]{1,20}$/.test(cmd)) throw new Error("Use letters, numbers, underscore only (max 20)");
  if (!text) throw new Error("Response is empty");
  if (text.length > 400) throw new Error("Response is too long (max 400)");
  const all = readAll().filter((c) => c.name !== cmd);
  const created = { name: cmd, response: text, who };
  all.push(created);
  writeAll(all);
  return created;
}

export function setCustomCommandAccess(name: string, who: AccessLevel): void {
  const key = normalizeName(name);
  writeAll(readAll().map((c) => (c.name === key ? { ...c, who } : c)));
}

export function removeCustomCommand(name: string): void {
  writeAll(readAll().filter((c) => c.name !== normalizeName(name)));
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/^!+/, "");
}
