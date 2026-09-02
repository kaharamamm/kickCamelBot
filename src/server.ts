import express from "express";
import { assertReadyForAuth, config } from "./config.js";
import { createAuthUrl, exchangeCode } from "./auth/oauth.js";
import { loadBotTokens, loadTokens, saveBotTokens, saveTokens } from "./auth/tokenStore.js";
import { addChannel, parseChannelSlug, removeChannelSlug } from "./bot/channelStore.js";
import { addCustomCommand, removeCustomCommand, setCustomCommandAccess } from "./bot/customCommands.js";
import { parseAccess, setAccess } from "./bot/access.js";
import {
  handleChatMessage,
  handleFollow,
  handleGiftSubs,
  handleKicksGift,
  handleNewSub,
  handleRaid,
  handleRewardRedemption,
  rememberBotIdentity,
  say,
} from "./bot/router.js";
import { getMyChannel, subscribeToEvents } from "./kick/api.js";
import { ChannelNotFoundError, lookupPublicChannel } from "./kick/publicChannel.js";
import { liveChatArmed, liveChatChannels, liveChatListening, liveChatStatus, startLiveChat } from "./kick/liveChat.js";
import { adminChatHistory, clearAdminChat, processAdminChat } from "./bot/adminChat.js";
import { applyDiscordRouting, discordStatus, startDiscord } from "./discord/client.js";
import { discordInviteUrl } from "./discord/invite.js";
import { parseAlwaysReplyJson, parseRoutesJson, type DiscordRouting } from "./discord/settings.js";
import { isPrivateDashboardHost } from "./bot/lan.js";
import { setCommandTimer } from "./bot/commandTimers.js";
import { RESERVED_COMMANDS } from "./bot/commands.js";
import { parseDotaAccount } from "./bot/dota.js";
import { getSettings, saveSettings, type AiLength } from "./bot/settings.js";
import { restartTimedCommands } from "./bot/timed.js";
import { addTimedCommand, removeTimedCommand, updateTimedMinutes } from "./bot/timedStore.js";
import { parseTimerMinutes } from "./bot/timerPreset.js";
import { dashboardPage, type DashTab } from "./web/dashboard.js";
import { removeModLog } from "./bot/modlog.js";
import { resetStreamStats, noteStreamContext } from "./bot/recap.js";
import { isDuplicateEvent, refreshKickPublicKey, verifyKickSignature } from "./kick/webhooks.js";
import type { ChatMessageEvent } from "./types.js";

type WebhookLog = {
  at: string;
  eventType: string;
  ok: boolean;
  detail: string;
};

const webhookLog: WebhookLog[] = [];

function noteWebhook(entry: WebhookLog): void {
  webhookLog.unshift(entry);
  if (webhookLog.length > 20) webhookLog.pop();
  console.log(`[webhook] ${entry.ok ? "ok" : "drop"} ${entry.eventType} ${entry.detail}`);
}

export function createServer() {
  const app = express();

  app.use((req, res, next) => {
    if (isPrivateDashboardHost(req.hostname)) {
      next();
      return;
    }
    const path = req.path;
    if (path === config.kick.webhookPath || path.startsWith(`${config.kick.webhookPath}/`)) {
      next();
      return;
    }
    res.status(404).end();
  });

  app.get("/health", (_req, res) => {
    void (async () => {
      const tokens = loadTokens();
      const bot = loadBotTokens();
      res.json({
        ok: true,
        bot: config.bot.name,
        authorized: Boolean(tokens?.accessToken),
        botAccount: bot?.user?.name ?? null,
        ai: Boolean(config.gemini.apiKey),
        lastWebhook: webhookLog[0] ?? null,
        webhookHits: webhookLog.length,
        liveChat: liveChatStatus,
        channels: liveChatChannels,
        discord: await discordStatus(),
      });
    })().catch((err) => {
      console.error("[health]", err);
      res.status(500).json({ ok: false });
    });
  });

  app.get("/say-test", (_req, res, next) => {
    void (async () => {
      await say("CamelBot write test — sending works. Try !ping in chat.");
      res.redirect("/?sent=1");
    })().catch(next);
  });

  app.post("/mod/remove", express.urlencoded({ extended: false }), (req, res) => {
    const id = String(req.body.id ?? "").trim();
    const page = Math.max(1, Number(req.body.page) || 1);
    if (!id || !removeModLog(id)) {
      res.redirect(`/mod?p=${page}&error=${encodeURIComponent("Could not delete that log entry.")}`);
      return;
    }
    res.redirect(`/mod?p=${page}&notice=${encodeURIComponent("Log entry deleted.")}`);
  });

  app.post("/recap/reset", express.urlencoded({ extended: false }), (_req, res) => {
    resetStreamStats();
    res.redirect(`/recap?notice=${encodeURIComponent("This stream's chat, emote, and game counts were reset. Last follow/sub/donation/raid stayed.")}`);
  });

  app.get("/", (req, res) => sendDash(req, res, "status"));
  app.get("/commands", (req, res) => sendDash(req, res, "commands"));
  app.get("/mod", (req, res) => sendDash(req, res, "mod"));
  app.get("/memory", (req, res) => sendDash(req, res, "memory"));
  app.get("/recap", (req, res) => sendDash(req, res, "recap"));
  app.get("/ai", (req, res) => sendDash(req, res, "ai"));
  app.get("/admin", (req, res) => sendDash(req, res, "admin"));
  app.get("/discord", (req, res) => sendDash(req, res, "discord"));

  app.get("/discord/invite", (_req, res) => {
    const url = discordInviteUrl();
    if (!url) {
      res.redirect(
        `/discord?error=${encodeURIComponent("Set DISCORD_CLIENT_ID in .env (Developer Portal → OAuth2 → Client ID).")}`,
      );
      return;
    }
    res.redirect(url);
  });

  app.post("/discord/settings", express.urlencoded({ extended: false }), (req, res) => {
    void (async () => {
      const routes = parseRoutesJson(String(req.body.routesJson ?? ""));
      const alwaysReplyUsers = parseAlwaysReplyJson(String(req.body.alwaysReplyJson ?? ""));
      if (!routes.length) {
        res.redirect(`/discord?error=${encodeURIComponent("Add at least one server listen/post route.")}`);
        return;
      }
      try {
        const next: DiscordRouting = { routes, alwaysReplyUsers };
        await applyDiscordRouting(next);
        res.redirect(`/discord?notice=${encodeURIComponent("Discord settings saved and bot reconnected.")}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Could not reconnect Discord.";
        res.redirect(`/discord?error=${encodeURIComponent(msg)}`);
      }
    })();
  });

  app.get("/admin/chat", (_req, res) => {
    res.type("json").json(adminChatHistory());
  });

  app.delete("/admin/chat", (_req, res) => {
    res.json({ ok: true, lines: clearAdminChat() });
  });

  app.post("/admin/chat", express.json({ limit: "8kb" }), (req, res) => {
    void (async () => {
      try {
        const message = String(req.body?.message ?? "").trim();
        if (!message) {
          res.status(400).json({ error: "Empty message.", lines: adminChatHistory() });
          return;
        }
        await processAdminChat(message);
        res.json({ ok: true, lines: adminChatHistory() });
      } catch (err) {
        console.warn("[admin-chat] route", err);
        const msg = err instanceof Error ? err.message : "Admin chat failed.";
        res.status(500).json({ error: msg, lines: adminChatHistory() });
      }
    })();
  });

  app.post("/channels", express.urlencoded({ extended: false }), (req, res) => {
    void (async () => {
      const parsed = parseChannelSlug(String(req.body.slug ?? ""));
      if (!parsed) {
        res.redirect(`/?error=${encodeURIComponent("Enter a real Kick username or URL")}`);
        return;
      }
      let info;
      try {
        info = await lookupPublicChannel(parsed);
      } catch (err) {
        const message =
          err instanceof ChannelNotFoundError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Could not check that channel";
        res.redirect(`/?error=${encodeURIComponent(message)}`);
        return;
      }
      try {
        const home = (await getMyChannel()).slug.toLowerCase();
        if (info.slug === home) {
          res.redirect(`/?notice=${encodeURIComponent("That's already the home channel")}`);
          return;
        }
      } catch {
        // still allow extra channels if home lookup fails
      }
      addChannel({ slug: info.slug, userId: info.userId, chatroomId: info.chatroomId });
      await startLiveChat();
      if (!liveChatChannels.includes(info.slug)) {
        res.redirect(
          `/?error=${encodeURIComponent(info.slug + " exists, but CamelBot could not join chat yet")}`,
        );
        return;
      }
      res.redirect(`/?notice=${encodeURIComponent("Added " + info.slug)}`);
    })().catch((err) => {
      res.redirect(`/?error=${encodeURIComponent(err instanceof Error ? err.message : "Could not add channel")}`);
    });
  });

  app.post("/channels/remove", express.urlencoded({ extended: false }), (req, res, next) => {
    void (async () => {
      const slug = String(req.body.slug ?? "").toLowerCase();
      const home = loadTokens() ? (await getMyChannel()).slug : "";
      if (slug && slug === home) {
        res.redirect(`/?notice=${encodeURIComponent("Home channel cannot be removed")}`);
        return;
      }
      removeChannelSlug(slug);
      await startLiveChat();
      res.redirect(`/?notice=${encodeURIComponent("Removed " + slug)}`);
    })().catch(next);
  });

  app.post("/commands", express.urlencoded({ extended: false }), (req, res) => {
    try {
      const name = String(req.body.name ?? "");
      const response = String(req.body.response ?? "");
      const key = name.trim().toLowerCase().replace(/^!+/, "");
      if (RESERVED_COMMANDS.has(key)) {
        res.redirect(`/commands?notice=${encodeURIComponent("!" + key + " is a built-in command")}`);
        return;
      }
      const created = addCustomCommand(name, response, parseAccess(req.body.who));
      res.redirect(`/commands?notice=${encodeURIComponent("Added !" + created.name)}`);
    } catch (err) {
      res.redirect(`/commands?notice=${encodeURIComponent(err instanceof Error ? err.message : "Could not add command")}`);
    }
  });

  app.post("/commands/remove", express.urlencoded({ extended: false }), (req, res) => {
    const name = String(req.body.name ?? "");
    removeCustomCommand(name);
    setCommandTimer(name, null);
    restartTimedCommands();
    res.redirect(`/commands?notice=${encodeURIComponent("Removed !" + name.replace(/^!+/, ""))}`);
  });

  app.post("/commands/access", express.urlencoded({ extended: false }), (req, res) => {
    const name = String(req.body.name ?? "");
    const who = parseAccess(req.body.who);
    setAccess(name, who);
    res.redirect(`/commands?notice=${encodeURIComponent("!" + name + " is now " + who)}`);
  });

  app.post("/commands/custom-access", express.urlencoded({ extended: false }), (req, res) => {
    const name = String(req.body.name ?? "");
    const who = parseAccess(req.body.who);
    setCustomCommandAccess(name, who);
    res.redirect(`/commands?notice=${encodeURIComponent("!" + name + " is now " + who)}`);
  });

  app.post("/commands/timer", express.urlencoded({ extended: false }), (req, res) => {
    const name = String(req.body.name ?? "").replace(/^!+/, "").trim().toLowerCase();
    const minutes = parseTimerMinutes(req.body.preset, req.body.custom);
    setCommandTimer(name, minutes);
    restartTimedCommands();
    const label = minutes ? `every ${minutes}m` : "no timer";
    res.redirect(`/commands?notice=${encodeURIComponent("!" + name + " timer: " + label)}`);
  });

  app.post("/commands/timed", express.urlencoded({ extended: false }), (req, res) => {
    try {
      const minutes = parseTimerMinutes(req.body.preset, req.body.custom);
      if (!minutes) throw new Error("Pick 5 min, 15 min, or custom");
      const created = addTimedCommand(String(req.body.text ?? ""), minutes);
      restartTimedCommands();
      res.redirect(`/commands?notice=${encodeURIComponent("Timed every " + created.minutes + "m")}`);
    } catch (err) {
      res.redirect(`/commands?notice=${encodeURIComponent(err instanceof Error ? err.message : "Could not add timed message")}`);
    }
  });

  app.post("/commands/timed/interval", express.urlencoded({ extended: false }), (req, res) => {
    const id = String(req.body.id ?? "");
    const minutes = parseTimerMinutes(req.body.preset, req.body.custom);
    updateTimedMinutes(id, minutes);
    restartTimedCommands();
    const label = minutes ? `every ${minutes}m` : "no timer (off)";
    res.redirect(`/commands?notice=${encodeURIComponent("Timed message " + label)}`);
  });

  app.post("/commands/timed/remove", express.urlencoded({ extended: false }), (req, res) => {
    removeTimedCommand(String(req.body.id ?? ""));
    restartTimedCommands();
    res.redirect(`/commands?notice=${encodeURIComponent("Removed timed message")}`);
  });

  app.post("/settings", express.urlencoded({ extended: false }), (req, res) => {
    const rawDota = String(req.body.dotaAccount ?? "").trim();
    const current = getSettings();
    const parsedDota = rawDota ? parseDotaAccount(rawDota) : null;
    saveSettings({
      engageOffline: String(req.body.engageOffline ?? "") === "1",
      dotaAccountId: !rawDota ? current.dotaAccountId : parsedDota ?? current.dotaAccountId,
    });
    const dotaNote =
      rawDota && !parsedDota ? " Could not parse that Dota account." : rawDota && parsedDota ? " Dota account linked." : "";
    res.redirect(`/?${rawDota && !parsedDota ? "error" : "notice"}=${encodeURIComponent("Settings saved." + dotaNote)}`);
  });

  app.post("/settings/dota", express.urlencoded({ extended: false }), (req, res) => {
    const shown: Record<string, string> = { ...getSettings().dotaShownByChannel };
    for (const [field, value] of Object.entries(req.body ?? {})) {
      if (!field.startsWith("shown_")) continue;
      const slug = field.slice("shown_".length).toLowerCase();
      const key = String(value);
      if (key === "main" || key === "smurf" || key === "kaiser" || key === "off") shown[slug] = key;
    }
    saveSettings({ dotaShownByChannel: shown });
    res.redirect(`/?notice=${encodeURIComponent("Shown Dota accounts saved.")}`);
  });

  app.post("/ai", express.urlencoded({ extended: false }), (req, res) => {
    const length = parseLength(req.body.length);
    saveSettings({
      ai: {
        personality: String(req.body.personality ?? ""),
        length,
        language: String(req.body.language ?? ""),
        canAnswer: String(req.body.canAnswer ?? ""),
        cannotAnswer: String(req.body.cannotAnswer ?? ""),
      },
    });
    res.redirect(`/ai?notice=${encodeURIComponent("AI settings saved")}`);
  });

  app.get("/login", (_req, res) => {
    try {
      assertReadyForAuth();
      res.redirect(createAuthUrl("streamer"));
    } catch (err) {
      res.status(500).type("html").send(errorPage(err));
    }
  });

  app.get("/login-bot", (_req, res) => {
    try {
      assertReadyForAuth();
      res.redirect(createAuthUrl("bot"));
    } catch (err) {
      res.status(500).type("html").send(errorPage(err));
    }
  });

  app.get("/callback", (req, res, next) => {
    void (async () => {
      const code = stringQuery(req.query.code);
      const state = stringQuery(req.query.state);
      const error = stringQuery(req.query.error);
      if (error) {
        res.status(400).send(`Kick OAuth error: ${error}`);
        return;
      }
      if (!code || !state) {
        res.status(400).send("Missing code/state. Open /login again.");
        return;
      }
      assertReadyForAuth();
      const { tokens, kind } = await exchangeCode(code, state);
      const me = await getMeWithRetry(tokens.accessToken);
      tokens.user = me;
      if (kind === "bot") {
        saveBotTokens(tokens);
        console.log(`[auth] bot account linked: ${me.name} (${me.user_id})`);
        res.redirect("/?bot=1");
        return;
      }
      saveTokens(tokens);
      await rememberBotIdentity();
      try {
        await subscribeToEvents();
      } catch (err) {
        console.warn("[events] subscribe failed (turn on webhooks in Kick first)", err);
      }
      res.redirect("/?ok=1");
    })().catch(next);
  });

  app.post(
    config.kick.webhookPath,
    express.raw({ type: "*/*", limit: "1mb" }),
    (req, res) => {
      const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body ?? "");
      const messageId = header(req, "kick-event-message-id");
      const timestamp = header(req, "kick-event-message-timestamp");
      const signature = header(req, "kick-event-signature");
      const eventType = header(req, "kick-event-type");

      if (!messageId || !timestamp || !signature) {
        noteWebhook({
          at: new Date().toISOString(),
          eventType: eventType || "(none)",
          ok: false,
          detail: "missing Kick signature headers",
        });
        res.status(401).send("missing signature headers");
        return;
      }
      if (!verifyKickSignature({ messageId, timestamp, signature, rawBody })) {
        noteWebhook({
          at: new Date().toISOString(),
          eventType: eventType || "(none)",
          ok: false,
          detail: "invalid signature",
        });
        res.status(401).send("invalid signature");
        return;
      }
      res.status(200).send("ok");
      let preview = rawBody.slice(0, 180);
      try {
        const parsed = JSON.parse(rawBody) as { sender?: { username?: string }; content?: string };
        preview = `${parsed.sender?.username ?? "?"}: ${parsed.content ?? eventType}`;
      } catch {
        // keep raw preview
      }
      noteWebhook({
        at: new Date().toISOString(),
        eventType: eventType || "(none)",
        ok: true,
        detail: preview,
      });
      if (isDuplicateEvent(messageId)) return;
      void dispatchEvent(eventType, rawBody).catch((err) => {
        console.warn("[webhook] handler failed", eventType, err);
      });
    },
  );

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(500).type("html").send(errorPage(err));
  });

  return app;
}

async function dispatchEvent(eventType: string, rawBody: string): Promise<void> {
  const payload = JSON.parse(rawBody) as Record<string, unknown>;
  switch (eventType) {
    case "chat.message.sent":
      if (liveChatArmed || liveChatListening()) return;
      await handleChatMessage(payload as ChatMessageEvent);
      return;
    case "channel.followed": {
      const follower = payload.follower as { username?: string } | undefined;
      if (follower?.username) await handleFollow(follower.username);
      return;
    }
    case "channel.raid":
    case "livestream.raid": {
      const raider =
        (payload.raider as { username?: string } | undefined)?.username ||
        (payload.from as { username?: string } | undefined)?.username ||
        (payload.host as { username?: string } | undefined)?.username ||
        (typeof payload.username === "string" ? payload.username : "");
      const viewers =
        Number(payload.viewer_count ?? payload.viewers ?? payload.number_viewers) || undefined;
      const broadcaster = payload.broadcaster as { user_id?: number } | undefined;
      if (raider) {
        await handleRaid({
          username: raider,
          viewers,
          broadcasterUserId: broadcaster?.user_id,
        });
      }
      return;
    }
    case "channel.subscription.new":
    case "channel.subscription.renewal": {
      const sub = payload.subscriber as { username?: string } | undefined;
      const months = typeof payload.duration === "number" ? payload.duration : undefined;
      if (sub?.username) await handleNewSub(sub.username, months);
      return;
    }
    case "channel.subscription.gifts": {
      const gifter = payload.gifter as { username?: string; is_anonymous?: boolean } | undefined;
      const giftees = Array.isArray(payload.giftees) ? payload.giftees : [];
      await handleGiftSubs({
        gifter: gifter?.username,
        count: giftees.length || 1,
        anonymous: Boolean(gifter?.is_anonymous),
      });
      return;
    }
    case "kicks.gifted": {
      const sender = payload.sender as { username?: string } | undefined;
      const gift = payload.gift as { amount?: number; name?: string } | undefined;
      if (sender?.username) {
        await handleKicksGift({
          username: sender.username,
          amount: Number(gift?.amount) || 0,
          name: gift?.name,
        });
      }
      return;
    }
    case "channel.reward.redemption.updated": {
      const redeemer = payload.redeemer as { username?: string } | undefined;
      const reward = payload.reward as { title?: string } | undefined;
      await handleRewardRedemption({
        username: redeemer?.username ?? "viewer",
        title: reward?.title ?? "reward",
        input: typeof payload.user_input === "string" ? payload.user_input : undefined,
        status: typeof payload.status === "string" ? payload.status : "",
      });
      return;
    }
    case "livestream.metadata.updated": {
      const meta = payload as {
        metadata?: { title?: string; category?: { name?: string } };
        title?: string;
        category?: { name?: string };
      };
      const game = meta.metadata?.category?.name || meta.category?.name;
      if (game) noteStreamContext(game, undefined, true);
      return;
    }
    default:
      return;
  }
}

async function getMeWithRetry(accessToken: string): Promise<{ user_id: number; name: string }> {
  const res = await fetch(`${config.kick.apiBase}/users`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = (await res.json()) as { data?: Array<{ user_id: number; name: string }> };
  const me = json.data?.[0];
  if (!me) throw new Error("Authorized, but Kick did not return the user profile.");
  return me;
}

export async function bootIntegrations(): Promise<void> {
  await refreshKickPublicKey();
  try {
    await startDiscord();
  } catch (err) {
    console.warn("[discord] failed to start", err);
  }
  if (loadTokens()) {
    await rememberBotIdentity();
    try {
      await startLiveChat();
    } catch (err) {
      console.warn("[live-chat] failed to start", err);
    }
    try {
      await subscribeToEvents();
    } catch (err) {
      console.warn("[events] subscribe on boot failed", err);
    }
  }
}

function sendDash(req: express.Request, res: express.Response, tab: DashTab): void {
  void (async () => {
    const tokens = loadTokens();
    const bot = loadBotTokens();
    const error = stringQuery(req.query.error);
    const notice =
      error ||
      stringQuery(req.query.notice) ||
      (req.query.sent ? "Test message sent" : "") ||
      (req.query.ok ? "Streamer account authorized" : "") ||
      (req.query.bot ? "Bot account linked" : "");
    res.type("html").send(
      await dashboardPage({
        tab,
        authorized: Boolean(tokens?.accessToken),
        botAccount: bot?.user?.name,
        notice,
        noticeBad: Boolean(error),
        page: Math.max(1, Number(req.query.p) || 1),
      }),
    );
  })().catch((err) => {
    console.error("[dashboard]", err);
    res.status(500).send("Dashboard error");
  });
}

function parseLength(value: unknown): AiLength {
  if (value === "short" || value === "medium" || value === "long") return value;
  return "medium";
}

function stringQuery(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return "";
}

function header(req: express.Request, name: string): string {
  const value = req.headers[name];
  return typeof value === "string" ? value : "";
}

function errorPage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return `<!doctype html><meta charset="utf-8"><pre>${escapeHtml(message)}</pre>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch);
}
