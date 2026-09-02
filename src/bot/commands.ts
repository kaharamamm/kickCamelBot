import { config } from "../config.js";
import {
  createReward,
  getLeaderboard,
  getMyChannel,
  getRewards,
  searchCategories,
  updateStreamCategory,
  updateStreamTitle,
} from "../kick/api.js";
import { canUseCommand, canUseLevel, DEFAULT_ACCESS, getAccess, primaryCommand } from "./access.js";
import { formatAnkaraClock } from "./clock.js";
import { getCustomCommand, listCustomCommands } from "./customCommands.js";
import { closePoll, currentPoll, castVote, parsePollArgs, startPoll } from "./polls.js";
import { displayName } from "./permissions.js";
import { getPoints } from "./points.js";
import { checkSongSafety } from "./songSafety.js";
import { addSong, formatQueue, nowPlaying, skipSong } from "./songs.js";
import { dotaCommand, dotaLastGame, dotaMedal, dotaMmr, dotaWl } from "./dota.js";
import { channelLiveStatus } from "./liveState.js";
import { yenimahalleWeather } from "./weather.js";
import { pulseEmoteMode, setEmoteOnly } from "./emoteMode.js";
import { parseToggleArgs, pulseSlowMode, setFollowOnly, setSlowMode, setSubOnly, streamIsLive, clearChat, createClip } from "./chatModes.js";
import type { IncomingChat, KicksLeaderboard } from "../types.js";

const EIGHT_BALL = [
  "Yes.",
  "No.",
  "Ask again later.",
  "Absolutely.",
  "Not a chance.",
  "The vibes say yes.",
  "Don't count on it.",
  "Looks good.",
  "Evet.",
  "Hayır.",
  "Olabilir.",
  "Kesin gibi duruyor.",
];

export const BUILTIN_COMMANDS: Array<{ name: string; what: string }> = [
  { name: "ping", what: "Check that CamelBot is alive" },
  { name: "commands", what: "List commands" },
  { name: "roll", what: "Random number" },
  { name: "coinflip", what: "Heads or tails" },
  { name: "8ball", what: "Magic 8-ball" },
  { name: "sr", what: "Song request (home, safety-checked)" },
  { name: "song", what: "Now playing" },
  { name: "queue", what: "Song queue" },
  { name: "skip", what: "Skip current song" },
  { name: "title", what: "Show or change stream title (home)" },
  { name: "category", what: "Show or change stream category (home)" },
  { name: "emoteonly", what: "Turn emote-only chat on/off, or pulse 5–60s (home, mods)" },
  { name: "slow", what: "Slow mode on/off/pulse (home, mods)" },
  { name: "followonly", what: "Follower-only chat on/off (home, mods)" },
  { name: "subonly", what: "Subscriber-only chat on/off (home, mods)" },
  { name: "clear", what: "Clear chat (home, mods)" },
  { name: "clip", what: "Clip the last 10–180s of the stream (home, mods)" },
  { name: "top", what: "KICKs leaderboard (home)" },
  { name: "rewards", what: "Loyalty rewards (home)" },
  { name: "points", what: "Your quiz channel points (home)" },
  { name: "draw", what: "Draw an image from a prompt (posts a link)" },
  { name: "poll", what: "Start a chat poll / gamble (mods)" },
  { name: "vote", what: "Vote in the current poll" },
  { name: "rewardadd", what: "Create a loyalty reward" },
  { name: "time", what: "Ankara date and time" },
  { name: "weather", what: "Yenimahalle / Ankara weather" },
  { name: "dota", what: "OpenDota last-match / rank facts (shown account, or !dota smurf / kaiser)" },
  { name: "mmr", what: "Rank / MMR estimate for this channel's shown Dota account" },
  { name: "wl", what: "Win-loss this stream (or today if not live)" },
  { name: "lastgame", what: "Last parsed match (hero, KDA, result, match id)" },
  { name: "medal", what: "Current medal / leaderboard rank" },
];

const DOTA_COMMAND_NAMES = new Set([
  "dota",
  "mmr",
  "rank",
  "medal",
  "wl",
  "score",
  "record",
  "lg",
  "lgs",
  "lastgame",
]);

export function isDotaChatCommand(content: string): boolean {
  const prefix = config.bot.prefix;
  if (!content.startsWith(prefix)) return false;
  const name = content.slice(prefix.length).trim().split(/\s+/)[0]?.replace(/^!+/, "").toLowerCase() ?? "";
  return DOTA_COMMAND_NAMES.has(name);
}

export const RESERVED_COMMANDS = new Set(
  [
    "commands",
    "help",
    "cmd",
    "cb",
    "ping",
    "roll",
    "random",
    "zar",
    "coinflip",
    "coin",
    "yazitura",
    "8ball",
    "8",
    "sr",
    "songrequest",
    "istek",
    "song",
    "np",
    "playing",
    "queue",
    "q",
    "skip",
    "title",
    "baslik",
    "category",
    "game",
    "cat",
    "kategori",
    "emoteonly",
    "emotes",
    "emote",
    "slow",
    "slowmode",
    "followonly",
    "followers",
    "subonly",
    "subscribers",
    "clear",
    "clip",
    "klip",
    "top",
    "kicks",
    "leaderboard",
    "lb",
    "rewards",
    "points",
    "loyalty",
    "oduller",
    "draw",
    "image",
    "drawimage",
    "poll",
    "gamble",
    "vote",
    "pollend",
    "time",
    "saat",
    "weather",
    "hava",
    "dota",
    "mmr",
    "rank",
    "wl",
    "score",
    "record",
    "medal",
    "lg",
    "lgs",
    "lastgame",
    "rewardadd",
    "addreward",
  ],
);

export async function handleCommand(chat: IncomingChat): Promise<string | null> {
  const prefix = config.bot.prefix;
  const trimmed = chat.content.trim();
  if (!trimmed.startsWith(prefix)) return null;

  const without = trimmed.slice(prefix.length).trim();
  const bits = without.split(/\s+/);
  const rawName = (bits[0] ?? "").replace(/^!+/, "");
  const name = rawName.toLowerCase();
  const args = bits.slice(1).join(" ").trim();
  const who = displayName(chat.sender);
  const key = primaryCommand(name);

  if (RESERVED_COMMANDS.has(name) || DEFAULT_ACCESS[key]) {
    if (!canUseCommand(name, chat.sender, chat.broadcaster)) {
      return `@${who} only ${getAccess(name)} can use ${prefix}${key}.`;
    }
  }

  switch (name) {
    case "commands":
    case "help":
    case "cmd":
    case "cb":
      return [
        `${prefix}ping ${prefix}roll ${prefix}random ${prefix}coinflip ${prefix}8ball`,
        `${prefix}sr ${prefix}song ${prefix}queue ${prefix}skip`,
        `${prefix}title ${prefix}category ${prefix}emoteonly ${prefix}slow ${prefix}clip ${prefix}top ${prefix}rewards ${prefix}points ${prefix}draw ${prefix}poll ${prefix}time ${prefix}weather ${prefix}dota ${prefix}mmr ${prefix}wl ${prefix}lastgame`,
        customHelp(prefix),
        `Ping me with @${config.bot.name} to talk.`,
      ]
        .filter(Boolean)
        .join(" · ");

    case "ping":
      return "CamelBot pong";

    case "roll":
    case "random":
    case "zar":
      return roll(who, args);

    case "coinflip":
    case "coin":
    case "yazitura":
      return `@${who} ${Math.random() < 0.5 ? "Heads / Yazı" : "Tails / Tura"}`;

    case "8ball":
    case "8":
      if (!args) return `@${who} ask a question. Example: ${prefix}8ball will we hit partner today?`;
      return `@${who} ${EIGHT_BALL[Math.floor(Math.random() * EIGHT_BALL.length)]}`;

    case "sr":
    case "songrequest":
    case "istek": {
      return homeOnly(chat, async () => {
        const safety = await checkSongSafety(args);
        if (!safety.ok) return `@${who} ${safety.reason}`;
        const result = addSong(args, who);
        if (!result.ok) return `@${who} ${result.reason}`;
        return `@${who} added "${args.trim()}" — #${result.position} in queue`;
      }, "song requests");
    }

    case "song":
    case "np":
    case "playing": {
      const current = nowPlaying();
      return current
        ? `Now playing: ${current.title} (requested by ${current.requester})`
        : "Nothing in queue. Request with !sr <song>";
    }

    case "queue":
    case "q":
      return formatQueue();

    case "skip": {
      const skipped = skipSong();
      if (!skipped) return "Queue is already empty.";
      const next = nowPlaying();
      return next
        ? `Skipped ${skipped.title}. Next: ${next.title}`
        : `Skipped ${skipped.title}. Queue is empty.`;
    }

    case "title":
    case "baslik":
      return homeOnly(chat, () => handleTitle(args), "title");

    case "category":
    case "game":
    case "cat":
    case "kategori":
      return homeOnly(chat, () => handleCategory(args), "category");

    case "emoteonly":
    case "emotes":
    case "emote":
      return homeOnly(chat, () => handleEmoteOnly(chat.broadcaster.user_id, args), "emoteonly");

    case "slow":
    case "slowmode":
      return homeOnly(chat, () => handleSlow(chat.broadcaster.user_id, args), "slow");

    case "followonly":
    case "followers":
      return homeOnly(chat, () => handleFollowOnly(args), "followonly");

    case "subonly":
    case "subscribers":
      return homeOnly(chat, () => handleSubOnly(args), "subonly");

    case "clear":
      return homeOnly(chat, () => handleClear(), "clear");

    case "clip":
    case "klip":
      return homeOnly(chat, () => handleClip(args), "clip");

    case "top":
    case "kicks":
    case "leaderboard":
    case "lb":
      return homeOnly(chat, () => handleLeaderboard(args), "leaderboard");

    case "rewards":
    case "loyalty":
    case "oduller":
      return homeOnly(chat, () => handleRewards(), "rewards");

    case "points": {
      return homeOnly(chat, () => {
        const total = getPoints(chat.sender.user_id);
        return `@${who} you have ${total} channel points.`;
      }, "points");
    }

    case "rewardadd":
    case "addreward":
      return homeOnly(chat, () => handleRewardAdd(args), "rewards");

    case "draw":
    case "image":
    case "drawimage":
      return handleDraw(who, args);

    case "time":
    case "saat":
      return formatAnkaraClock();

    case "weather":
    case "hava": {
      const w = await yenimahalleWeather();
      return `${w} Classic Yenimahalle — if you wanted sunshine you picked the wrong city.`;
    }

    case "dota":
      return dotaCommand(args, channelSlug(chat));

    case "mmr":
    case "rank":
      return dotaMmr(channelSlug(chat), args);

    case "medal":
      return dotaMedal(channelSlug(chat), args);

    case "wl":
    case "score":
    case "record": {
      const slug = channelSlug(chat);
      const status = await channelLiveStatus(slug, chat.broadcaster.user_id);
      return dotaWl(slug, args, status.live ? status.startedAt ?? null : null, status.live);
    }

    case "lg":
    case "lgs":
    case "lastgame":
      return dotaLastGame(channelSlug(chat), args);

    case "poll":
    case "gamble": {
      const parsed = parsePollArgs(name === "gamble" && !args ? "Will he win the game?" : args);
      return startPoll({
        broadcasterUserId: chat.broadcaster.user_id,
        question: parsed.question,
        options: parsed.options,
      });
    }

    case "vote": {
      const poll = currentPoll(chat.broadcaster.user_id);
      if (!poll) return "No poll running. Mods can start one with !poll or !gamble";
      const locked = castVote(chat.broadcaster.user_id, chat.sender.user_id, args || "");
      if (!locked) return `@${who} options: ${poll.options.join(", ")}`;
      return "";
    }

    case "pollend":
      return closePoll(chat.broadcaster.user_id, false);

    default: {
      const custom = getCustomCommand(name);
      if (!custom) return null;
      if (!canUseLevel(custom.who, chat.sender, chat.broadcaster)) {
        return `@${who} only ${custom.who} can use ${prefix}${custom.name}.`;
      }
      return custom.response.replaceAll("{user}", who).replaceAll("{name}", who);
    }
  }
}

function customHelp(prefix: string): string {
  const extra = listCustomCommands();
  if (extra.length === 0) return "";
  return extra.map((c) => `${prefix}${c.name}`).join(" ");
}

function roll(who: string, args: string): string {
  const nums = args
    .split(/[^\d]+/)
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && n > 0);
  let min = 1;
  let max = 100;
  if (nums.length === 1 && nums[0]) max = Math.min(1_000_000, Math.floor(nums[0]));
  if (nums.length >= 2 && nums[0] && nums[1]) {
    min = Math.floor(Math.min(nums[0], nums[1]));
    max = Math.floor(Math.max(nums[0], nums[1]));
  }
  if (max > 1_000_000) max = 1_000_000;
  const value = min + Math.floor(Math.random() * (max - min + 1));
  return `@${who} rolls ${value} (${min}-${max})`;
}

async function handleTitle(args: string): Promise<string> {
  try {
    if (!args) {
      const channel = await getMyChannel();
      return `Title: ${channel.stream_title || "(empty)"}`;
    }
    const next = args.slice(0, 100);
    await updateStreamTitle(next);
    return `Title updated → ${next}`;
  } catch (err) {
    console.warn("[title]", err);
    return "Couldn't update the title. Check that CamelBot is authorized with channel write.";
  }
}

async function handleCategory(args: string): Promise<string> {
  try {
    const channel = await getMyChannel();
    if (!args) {
      return `Category: ${channel.category?.name || "(none)"}`;
    }
    const hits = await searchCategories(args);
    if (hits.length === 0) return `No Kick category matching "${args.slice(0, 60)}".`;
    const wanted = args.trim().toLowerCase();
    const pick =
      hits.find((h) => h.name.toLowerCase() === wanted) ||
      hits.find((h) => h.name.toLowerCase().startsWith(wanted)) ||
      hits[0]!;
    await updateStreamCategory(pick.id);
    return `Category updated → ${pick.name}`;
  } catch (err) {
    console.warn("[category]", err);
    return "Couldn't update the category. Check that CamelBot is authorized with channel write.";
  }
}

async function handleEmoteOnly(broadcasterUserId: number, args: string): Promise<string> {
  if (!(await streamIsLive())) return "Stream is offline — not changing emote-only.";
  const t = parseToggleArgs(args);
  try {
    if (t === "" || t === "pulse" || typeof t === "number") {
      const seconds = typeof t === "number" ? t : undefined;
      const ok = await pulseEmoteMode(broadcasterUserId, { seconds, force: true });
      return ok ? "" : "Couldn't turn emote-only on. CamelBot needs mod rights on this channel.";
    }
    if (t === "on") {
      const ok = await setEmoteOnly(true);
      return ok ? "Emote-only is ON." : "Couldn't enable emote-only.";
    }
    return (await setEmoteOnly(false)) ? "Emote-only is OFF." : "Couldn't disable emote-only.";
  } catch (err) {
    console.warn("[emoteonly]", err);
    return "Couldn't change emote-only.";
  }
}

async function handleSlow(broadcasterUserId: number, args: string): Promise<string> {
  const t = parseToggleArgs(args);
  try {
    if (t === "" || t === "pulse") {
      const ok = await pulseSlowMode(broadcasterUserId, { force: true });
      return ok ? "" : "Couldn't turn slow mode on.";
    }
    if (typeof t === "number") {
      const ok = await setSlowMode(true, t);
      return ok ? `Slow mode ON (${t}s).` : "Couldn't enable slow mode.";
    }
    if (t === "on") {
      const ok = await setSlowMode(true, 10);
      return ok ? "Slow mode is ON (10s)." : "Couldn't enable slow mode.";
    }
    return (await setSlowMode(false)) ? "Slow mode is OFF." : "Couldn't disable slow mode.";
  } catch (err) {
    console.warn("[slow]", err);
    return "Couldn't change slow mode.";
  }
}

async function handleFollowOnly(args: string): Promise<string> {
  const t = parseToggleArgs(args);
  const on = t !== "off";
  const ok = await setFollowOnly(on);
  return ok ? `Follower-only is ${on ? "ON" : "OFF"}.` : "Couldn't change follower-only.";
}

async function handleSubOnly(args: string): Promise<string> {
  const t = parseToggleArgs(args);
  const on = t !== "off";
  const ok = await setSubOnly(on);
  return ok ? `Sub-only is ${on ? "ON" : "OFF"}.` : "Couldn't change sub-only. This one may need the streamer login.";
}

async function handleClear(): Promise<string> {
  const ok = await clearChat();
  return ok ? "Chat cleared." : "Couldn't clear chat.";
}

async function handleClip(args: string): Promise<string> {
  const bits = args.trim().split(/\s+/);
  const seconds = bits[0] && /^\d+$/.test(bits[0]) ? Number(bits[0]) : 30;
  const title = (bits[0] && /^\d+$/.test(bits[0]) ? bits.slice(1) : bits).join(" ").trim();
  const ok = await createClip({ seconds, title: title || "CamelBot clip" });
  return ok
    ? `Clipping the last ${Math.min(180, Math.max(10, seconds))}s.`
    : "Couldn't clip. Kick may require the clipping program, and the stream must be live.";
}

async function handleLeaderboard(args: string): Promise<string> {
  try {
    const board = await getLeaderboard(5);
    const key = parseLeaderboardKey(args);
    const rows = board[key] ?? [];
    if (rows.length === 0) return `No KICKs ${key} leaderboard yet.`;
    const label = key === "lifetime" ? "all-time" : key;
    const line = rows
      .slice(0, 5)
      .map((row) => `${row.rank}. ${row.username} (${row.gifted_amount})`)
      .join(" · ");
    return `Top KICKs (${label}): ${line}`;
  } catch (err) {
    console.warn("[leaderboard]", err);
    return "Couldn't read the KICKs leaderboard.";
  }
}

function parseLeaderboardKey(args: string): keyof KicksLeaderboard {
  const token = args.trim().toLowerCase();
  if (token.startsWith("week") || token === "hafta") return "week";
  if (token.startsWith("month") || token === "ay") return "month";
  return "lifetime";
}

async function handleRewards(): Promise<string> {
  try {
    const rewards = await getRewards();
    const live = rewards.filter((r) => r.is_enabled && !r.is_paused);
    if (live.length === 0) return "No enabled loyalty rewards yet. Mods can add one with !rewardadd 100 Title";
    return live
      .slice(0, 8)
      .map((r) => `${r.title} (${r.cost})`)
      .join(" · ");
  } catch (err) {
    console.warn("[rewards]", err);
    return "Couldn't read loyalty rewards.";
  }
}

async function handleDraw(who: string, args: string): Promise<string> {
  const prompt = args.replace(/\s+/g, " ").trim();
  if (prompt.length < 3) return `@${who} tell me what to draw. Example: ${config.bot.prefix}draw bald camel in ancient armor`;
  const clipped = prompt.slice(0, 180);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(clipped)}?nologo=true&width=1024&height=1024&seed=${Date.now() % 99999}`;
  return `@${who} ${clipped} → ${url}`;
}

export async function runScheduledCommand(name: string): Promise<string | null> {
  const skip = new Set(["skip", "sr", "rewardadd", "points", "draw", "image", "drawimage", "poll", "vote", "gamble", "pollend"]);
  if (skip.has(name)) return null;
  try {
    const channel = await getMyChannel();
    const actor = {
      user_id: channel.broadcaster_user_id,
      username: channel.slug,
      channel_slug: channel.slug,
      identity: { badges: [{ type: "broadcaster", text: "broadcaster" }] },
    };
    return handleCommand({
      messageId: "",
      content: `${config.bot.prefix}${name}`,
      sender: actor,
      broadcaster: actor,
    });
  } catch (err) {
    console.warn("[timed-command]", name, err);
    return null;
  }
}

async function handleRewardAdd(args: string): Promise<string> {
  const match = args.match(/^(\d+)\s+(.+)$/);
  if (!match) return "Usage: !rewardadd 100 Song Request";
  const cost = Number(match[1]);
  const title = match[2]?.trim() ?? "";
  if (!title || !Number.isFinite(cost) || cost < 1) return "Usage: !rewardadd 100 Song Request";
  try {
    const created = await createReward(title.slice(0, 50), Math.floor(cost));
    return `Reward added: ${created.title} (${created.cost} points)`;
  } catch (err) {
    console.warn("[rewardadd]", err);
    return "Couldn't create that reward. Kick only lets this app edit rewards it created.";
  }
}

async function homeOnly(
  chat: IncomingChat,
  run: () => Promise<string> | string,
  label: string,
): Promise<string> {
  try {
    const home = await getMyChannel();
    if (chat.broadcaster.user_id !== home.broadcaster_user_id) {
      return `!${label} only works on the home channel. Try ${config.bot.prefix}ping or @${config.bot.name} here.`;
    }
  } catch {
    // if we cannot resolve home channel, still attempt the command
  }
  return run();
}

function channelSlug(chat: IncomingChat): string {
  return (chat.broadcaster.channel_slug || chat.broadcaster.username || "").toLowerCase();
}
