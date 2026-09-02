import { loadBotTokens } from "../auth/tokenStore.js";
import { config } from "../config.js";
import type { KickActor } from "../types.js";

const OTHER_BOTS = [
  "kickbot",
  "streamlabs",
  "streamelements",
  "nightbot",
  "moobot",
  "wizebot",
  "fossabot",
  "sery_bot",
  "commanderroot",
  "ankhbot",
  "phantombot",
  "botrix",
  "own3d",
];

export function isOwnBot(actor: KickActor): boolean {
  const bot = loadBotTokens()?.user;
  if (bot?.user_id && actor.user_id === bot.user_id) return true;
  const name = (actor.username || actor.channel_slug || "").toLowerCase();
  if (!name) return false;
  if (name === config.bot.name.toLowerCase()) return true;
  if (bot?.name && name === bot.name.toLowerCase()) return true;
  return false;
}

export function isOwnBotName(name?: string): boolean {
  if (!name) return false;
  return isOwnBot({ user_id: 0, username: name, channel_slug: name });
}

export function isChatBot(actor: KickActor): boolean {
  if (isOwnBot(actor)) return false;
  const name = (actor.username || actor.channel_slug || "").toLowerCase();
  if (OTHER_BOTS.includes(name)) return true;
  return false;
}

export function talkingToOtherBot(content: string): boolean {
  const text = content.toLowerCase();
  const me = config.bot.name.toLowerCase();
  const talkingToUs = text.includes(`@${me}`) || text.startsWith(`${me} `) || text === me;
  if (talkingToUs) return false;
  return OTHER_BOTS.some((bot) => text.includes(`@${bot}`) || text.startsWith(`${bot} `));
}

export function stripBotTags(text: string): string {
  const me = config.bot.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let out = text;
  for (const bot of OTHER_BOTS) {
    out = out.replace(new RegExp(`@${bot}\\b`, "gi"), "");
  }
  out = out.replace(new RegExp(`@${me}\\b`, "gi"), "");
  return out.replace(/\s+/g, " ").trim();
}
