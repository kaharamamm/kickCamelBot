import { ACCESS_LEVELS, getAccess, type AccessLevel } from "../bot/access.js";
import { extraChannelSlugs, extraChannels } from "../bot/channelStore.js";
import { formatAnkaraShort } from "../bot/clock.js";
import { lanUrls, tunnelBaseUrl } from "../bot/lan.js";
import { BUILTIN_COMMANDS } from "../bot/commands.js";
import { listCustomCommands } from "../bot/customCommands.js";
import { getCommandTimer } from "../bot/commandTimers.js";
import { DOTA_PROFILES, defaultShownKey, steamApiKeyConfigured } from "../bot/dota.js";
import { listModLog } from "../bot/modlog.js";
import { listChatSummaries } from "../bot/chatMemory.js";
import { KING_ID, listPeople } from "../bot/memory.js";
import { formatRecapAgo, formatRecapDur, recapSnapshot } from "../bot/recap.js";
import { getSettings, type AiLength, type AiProviderId } from "../bot/settings.js";
import { AI_CATALOG, anyAiConfigured, providerStatus } from "../bot/aiProviders.js";
import { listTimedCommands } from "../bot/timedStore.js";
import { timerPreset } from "../bot/timerPreset.js";
import { config, reloadEnv } from "../config.js";
import { discordStatus } from "../discord/client.js";
import { discordInviteUrl } from "../discord/invite.js";
import {
  DISCORD_IDENTITIES,
  DISCORD_KING_ID,
  discordKingUserId,
} from "../discord/identities.js";
import { getDiscordRouting } from "../discord/settings.js";
import { liveChatChannels, liveChatStatus } from "../kick/liveChat.js";
import { EMOTE_MOODS, listEmotesForUi } from "../bot/kickEmotes.js";
import { getEmoteMoodOverrides } from "../bot/emoteMoodStore.js";

export type DashTab =
  | "status"
  | "commands"
  | "ai"
  | "mod"
  | "memory"
  | "recap"
  | "admin"
  | "discord"
  | "terminal"
  | "emotes";

const PAGE_SIZE = 12;

export async function dashboardPage(params: {
  tab: DashTab;
  authorized: boolean;
  botAccount?: string;
  notice?: string;
  noticeBad?: boolean;
  page?: number;
}): Promise<string> {
  reloadEnv();
  const page = Math.max(1, params.page ?? 1);
  const inner =
    params.tab === "commands"
      ? commandsBody()
      : params.tab === "ai"
        ? aiBody()
        : params.tab === "mod"
          ? modBody(page)
          : params.tab === "memory"
            ? memoryBody(page)
            : params.tab === "recap"
              ? recapBody()
              : params.tab === "admin"
                ? adminBody()
                : params.tab === "discord"
                  ? await discordBody()
                  : params.tab === "terminal"
                    ? terminalBody()
                    : params.tab === "emotes"
                      ? emotesBody()
                      : statusBody(params.authorized, params.botAccount);
  return layout(params.tab, params.notice ?? "", inner, params.noticeBad);
}

function layout(tab: DashTab, notice: string, inner: string, noticeBad = false): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${config.bot.name}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body { margin: 0; font: 15px/1.5 system-ui, sans-serif; background: #0b0b0d; color: #ececec; }
  body.emotes-page main { max-width: 90rem; overflow: hidden; display: flex; flex-direction: column; }
  body.emotes-page .emote-shell { flex: 1; min-height: 0; display: flex; flex-direction: column; margin-bottom: 0; overflow: hidden; }
  body.emotes-page .emote-shell-head { flex-shrink: 0; }
  body.emotes-page .emote-grid-scroll { flex: 1; min-height: 0; overflow: auto; padding-right: .25rem; margin-top: .75rem; }
  header { border-bottom: 1px solid #2c2c33; background: #121216; flex-shrink: 0; }
  .bar { max-width: 72rem; margin: 0 auto; padding: 1rem 1.2rem .15rem; }
  h1 { margin: 0; font-size: 1.45rem; }
  nav { display: flex; gap: .4rem; max-width: 72rem; margin: 0 auto; padding: .7rem 1.2rem 0; }
  nav a { color: #9a9aa3; text-decoration: none; padding: .45rem .75rem; border-radius: 10px 10px 0 0; }
  nav a.on { background: #16161a; color: #53fc18; border: 1px solid #2c2c33; border-bottom-color: #16161a; }
  main { max-width: 72rem; margin: 0 auto; padding: 1.2rem 1.2rem 3.5rem; }
  h2 { margin: 0 0 .7rem; font-size: 1.05rem; }
  .card-head { display: flex; flex-direction: row; align-items: center; justify-content: space-between; gap: .7rem; margin: 0 0 .7rem; }
  .card-head h2 { margin: 0; }
  .split { display: grid; grid-template-columns: 1.15fr 0.9fr; gap: 1rem; align-items: start; }
  .split > .card { margin-bottom: 0; }
  .stack-col { display: flex; flex-direction: column; gap: 1rem; min-width: 0; }
  .stack-col > .card { margin-bottom: 0; }
  .list-scroll { flex: 1; min-height: 0; overflow: auto; }
  .pager { display: flex; gap: .5rem; align-items: center; margin-top: .85rem; flex-wrap: wrap; }
  .pager .off { opacity: .35; pointer-events: none; }
  .danger-log { background: #6b1d24; color: #ffd0d4; border: 1px solid #a33a44; font-weight: 700; padding: .45rem .95rem; border-radius: 10px; font-size: 14px; cursor: pointer; }
  .said { color: #b0b0b8; font-size: 13px; margin-top: .2rem; font-style: italic; }
  h3 { margin: 1rem 0 .4rem; font-size: .92rem; color: #c8c8d0; font-weight: 650; }
  .card { background: #16161a; border: 1px solid #2c2c33; border-radius: 16px; padding: 1.1rem 1.2rem; margin-bottom: 1rem; }
  .ok { color: #53fc18; } .warn { color: #ffb020; }
  .banner { background: #14280f; border: 1px solid #2f6a1c; color: #b8ff8a; border-radius: 12px; padding: .7rem 1rem; margin-bottom: 1rem; }
  .banner.bad { background: #2a1012; border-color: #7a2a32; color: #ffb4b8; }
  .tag.warn { border-color: #ffb020; color: #ffb020; }
  .tag.bad { border-color: #ff8a8a; color: #ff8a8a; }
  a { color: #53fc18; }
  p { margin: .35rem 0; }
  ul.list { list-style: none; padding: 0; margin: 0; }
  ul.list li { display: flex; gap: .55rem; align-items: center; padding: .55rem 0; border-bottom: 1px solid #2c2c33; flex-wrap: nowrap; }
  ul.list li:last-child { border-bottom: 0; }
  ul.list li a, ul.list .grow { flex: 1; min-width: 0; }
  code { color: #53fc18; font-weight: 700; min-width: 5.6rem; flex-shrink: 0; }
  .tag { font-size: 11px; border: 1px solid #53fc18; color: #53fc18; border-radius: 999px; padding: .08rem .5rem; white-space: nowrap; }
  .tag.dim { border-color: #6a6a74; color: #b0b0b8; }
  form.inline { display: flex; gap: .5rem; margin-top: .9rem; flex-wrap: wrap; align-items: center; }
  form.stack { display: grid; gap: .5rem; margin-top: .9rem; }
  input[type=text], input[type=number], textarea, select { background: #0b0b0d; border: 1px solid #3a3a44; color: #fff; border-radius: 10px; padding: .55rem .7rem; font: inherit; }
  input[type=text], textarea { width: 100%; }
  textarea { min-height: 4.2rem; resize: vertical; }
  textarea[name=personality] { min-height: 7.5rem; }
  select { min-width: 7.2rem; flex-shrink: 0; }
  body.tall-page { overflow: hidden; display: flex; flex-direction: column; }
  body.tall-page main { width: 100%; max-width: 72rem; align-self: center; flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; padding-bottom: 1rem; }
  body.tall-page.emotes-page main { max-width: 90rem; }
  body.tall-page .tall-card { width: 100%; flex: 1; min-height: 0; display: flex; flex-direction: column; margin-bottom: 0; }
  body.ai-page .ai-form { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: .45rem; margin-top: .5rem; }
  body.ai-page .ai-form textarea[name=personality] { flex: 1.6; min-height: 8rem; resize: none; }
  body.ai-page .ai-form textarea[name=canAnswer],
  body.ai-page .ai-form textarea[name=cannotAnswer] { flex: 0.85; min-height: 4.5rem; resize: none; }
  body.ai-page .ai-form .row { margin-top: auto; }
  body.admin-page main { width: 100%; max-width: 72rem; align-self: center; flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; padding-bottom: 1rem; }
  body.admin-page .admin-card { flex: 1; min-height: 0; display: flex; flex-direction: column; margin-bottom: 0; }
  .admin-log { flex: 1; min-height: 18rem; overflow: auto; background: #0b0b0d; border: 1px solid #2c2c33; border-radius: 12px; padding: .85rem 1rem; margin-top: .6rem; }
  .admin-line { margin: .55rem 0; white-space: pre-wrap; word-break: break-word; color: #fff; }
  .admin-line.user strong { color: #53fc18; }
  .admin-line.bot strong { color: #b47cff; }
  .admin-line.error { color: #ff8a8a; font-style: normal; }
  .admin-line.error strong { color: #ff6b6b; }
  .admin-line.executing { color: #b8b8c0; font-style: italic; }
  .admin-line.executing strong { color: #b47cff; opacity: .95; }
  .admin-compose { display: flex; gap: .55rem; margin-top: .85rem; align-items: flex-end; }
  .admin-compose input { flex: 1; }
  button, .btn { background: #53fc18; color: #041204; border: 0; border-radius: 10px; padding: .5rem .8rem; font-weight: 700; cursor: pointer; text-decoration: none; display: inline-block; }
  .btn.ghost { background: transparent; color: #53fc18; border: 1px solid #2f6a1c; }
  .danger { background: transparent; color: #ff8a8a; border: 1px solid #5a2a2a; font-weight: 600; padding: .3rem .65rem; }
  button.btn.danger, .btn.danger { padding: .5rem .8rem; font-weight: 700; font-size: inherit; line-height: inherit; }
  .row { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: .9rem; }
  .muted { color: #9a9aa3; font-size: 13px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: .35rem 1rem; }
  label.check { display: flex; gap: .6rem; align-items: flex-start; margin-top: .8rem; color: #c8c8d0; }
  .who, .timer { display: flex; gap: .4rem; align-items: center; flex-shrink: 0; flex-wrap: nowrap; }
  .timer input[type=number] { width: 4.2rem; }
  @media (max-width: 800px) {
    .grid, .split, .facts { grid-template-columns: 1fr; }
    ul.list li { flex-wrap: wrap; }
  }
  .mood { font-size: 1.15rem; font-weight: 700; }
  .facts { display: grid; grid-template-columns: 1fr 1fr; gap: .35rem 1.2rem; }
  .facts p { margin: .2rem 0; }
  .k { color: #9a9aa3; }
  .who-best { color: #7dff6a; font-weight: 800; }
  .who-worst { color: #ff6b6b; font-weight: 800; }
  .why { color: #fff; font-weight: 700; margin: .15rem 0 .75rem; }
  .said-full { margin: .35rem 0 0; color: #ececec; font-weight: 600; white-space: pre-wrap; word-break: break-word; }
  .add-row { display: flex; gap: .5rem; flex-wrap: wrap; align-items: flex-end; margin-top: .35rem; }
  .add-row label { display: flex; flex-direction: column; gap: .25rem; flex: 1; min-width: 9rem; font-size: 13px; color: #c8c8d0; }
  .add-row input[type=text], .add-row select { width: 100%; }
  .item-list { list-style: none; padding: 0; margin: .5rem 0 0; }
  .item-list li { display: flex; gap: .55rem; align-items: center; padding: .5rem 0; border-bottom: 1px solid #2c2c33; }
  .item-list li:last-child { border-bottom: 0; }
  .item-list .grow { flex: 1; min-width: 0; }
  .route-status { grid-column: 1 / -1; margin: .15rem 0; }
  body.terminal-page main { width: 100%; max-width: 72rem; align-self: center; flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; padding-bottom: 1rem; }
  body.terminal-page .terminal-card { flex: 1; min-height: 0; display: flex; flex-direction: column; margin-bottom: 0; }
  .terminal-log { flex: 1; min-height: 18rem; overflow: auto; background: #070709; border: 1px solid #2c2c33; border-radius: 12px; padding: .7rem .85rem; margin-top: .6rem; font: 13px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .term-line { margin: .2rem 0; white-space: pre-wrap; word-break: break-word; color: #c8c8d0; }
  .term-line .ts { color: #6a6a74; margin-right: .45rem; }
  .term-line .src { color: #7dff6a; margin-right: .45rem; }
  .term-line.think .src { color: #b47cff; }
  .term-line.ok .src { color: #53fc18; }
  .term-line.fail { color: #ffb4b8; }
  .term-line.fail .src { color: #ff6b6b; }
  .term-line.warn { color: #ffd28a; }
  .term-line.warn .src { color: #ffb020; }
  .emote-toolbar { display: flex; flex-wrap: wrap; gap: .6rem; align-items: center; margin: 0 0 1rem; }
  .emote-toolbar input[type=search] { flex: 1; min-width: 12rem; max-width: 22rem; }
  .emote-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(11.5rem, 1fr)); gap: .75rem; }
  .emote-card { background: #121216; border: 1px solid #2c2c33; border-radius: 14px; padding: .75rem; display: flex; flex-direction: column; gap: .45rem; align-items: stretch; }
  .emote-card.changed { border-color: #53fc18; }
  .emote-card img { width: 48px; height: 48px; object-fit: contain; align-self: center; image-rendering: auto; background: #0b0b0d; border-radius: 8px; }
  .emote-card .ename { font-size: 13px; font-weight: 650; text-align: center; word-break: break-word; }
  .emote-card .edef { font-size: 11px; color: #6a6a74; text-align: center; }
  .emote-card select { width: 100%; font-size: 13px; }
  .emote-counts { display: flex; flex-wrap: wrap; gap: .4rem; margin: 0 0 1rem; }
  .emote-counts span { background: #121216; border: 1px solid #2c2c33; border-radius: 999px; padding: .2rem .55rem; font-size: 12px; color: #b0b0b8; }
  .emote-counts span b { color: #53fc18; }
</style></head><body class="${
    tab === "ai" || tab === "mod" || tab === "memory" || tab === "admin" || tab === "terminal" || tab === "emotes"
      ? `tall-page${tab === "ai" ? " ai-page" : tab === "admin" ? " admin-page" : tab === "terminal" ? " terminal-page" : tab === "emotes" ? " emotes-page" : ""}`
      : ""
  }">
<header>
  <div class="bar"><h1>${config.bot.name}</h1></div>
  <nav>
    <a class="${tab === "status" ? "on" : ""}" href="/">Status</a>
    <a class="${tab === "commands" ? "on" : ""}" href="/commands">Commands</a>
    <a class="${tab === "mod" ? "on" : ""}" href="/mod">Mod log</a>
    <a class="${tab === "memory" ? "on" : ""}" href="/memory">Memory</a>
    <a class="${tab === "recap" ? "on" : ""}" href="/recap">Recap</a>
    <a class="${tab === "ai" ? "on" : ""}" href="/ai">AI</a>
    <a class="${tab === "admin" ? "on" : ""}" href="/admin">Admin</a>
    <a class="${tab === "terminal" ? "on" : ""}" href="/terminal">Terminal</a>
    <a class="${tab === "discord" ? "on" : ""}" href="/discord">Discord</a>
    <a class="${tab === "emotes" ? "on" : ""}" href="/emotes">Emojis</a>
  </nav>
</header>
<main>
  ${notice ? `<p class="banner${noticeBad || looksBadNotice(notice) ? " bad" : ""}">${escapeHtml(notice)}</p>` : ""}
  ${inner}
</main></body></html>`;
}

function statusBody(authorized: boolean, botAccount?: string): string {
  const settings = getSettings();
  const homeSlug = liveChatChannels[0] ?? "";
  const listed = [...new Set([homeSlug, ...liveChatChannels, ...extraChannelSlugs()].filter(Boolean))];
  const channelRows = listed
    .map((slug) => {
      const home = slug === homeSlug;
      return `<li>
        <a href="https://kick.com/${escapeHtml(slug)}" target="_blank" rel="noreferrer">${escapeHtml(slug)}</a>
        ${home ? '<span class="tag">home</span>' : '<span class="tag dim">extra</span>'}
        ${
          home
            ? ""
            : `<form method="post" action="/channels/remove"><input type="hidden" name="slug" value="${escapeHtml(slug)}"><button class="danger" type="submit">Remove</button></form>`
        }
      </li>`;
    })
    .join("");

  return `
  <div class="split">
  <div class="card">
    <div class="card-head">
      <h2>Status</h2>
      <a class="btn" href="/">Refresh</a>
    </div>
    <div class="grid">
      <p>Login: ${authorized ? '<span class="ok">authorized</span>' : '<span class="warn">not authorized</span>'}</p>
      <p>Posts as: ${botAccount ? `<span class="ok">${escapeHtml(botAccount)}</span>` : '<span class="warn">streamer account</span>'}</p>
      <p>AI: ${anyAiConfigured() ? '<span class="ok">online</span>' : '<span class="warn">off — add a key in .env</span>'}</p>
      <p>Live chat: ${liveChatStatus.startsWith("listening") ? `<span class="ok">${escapeHtml(liveChatStatus)}</span>` : `<span class="warn">${escapeHtml(liveChatStatus)}</span>`}</p>
      <p>Mod /clear + chat modes: <span class="ok">streamer site session_token</span> (OAuth cannot run these)</p>
    </div>
    <p class="muted">Chat uses Kick's live socket. Follows, subs, gifts, and title changes need the Cloudflare webhook tunnel.</p>
    ${webhookFormula()}
    <p class="muted">On this network: ${
      lanUrls(config.port)
        .map((url) => `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`)
        .join(" · ") || "this PC only"
    }. The dashboard stays on this PC only. The tunnel only accepts Kick webhooks.</p>
    <form method="post" action="/settings">
      <label class="check">
        <input type="checkbox" name="engageOffline" value="1" ${settings.engageOffline ? "checked" : ""}>
        <span>Testing only: proactive chatter on the home channel while offline. Extra channels stay quiet unless live. Leave this off so CamelBot does not fill empty chat.</span>
      </label>
      <div class="row"><button type="submit">Save settings</button></div>
    </form>
    <h3>Dota 2 accounts</h3>
    <ul class="list">${DOTA_PROFILES.map(
      (p) => `<li>
        <span class="tag">${escapeHtml(p.key)}</span>
        <span class="grow">${escapeHtml(p.who)} · ${p.accountId}</span>
        <a href="${escapeHtml(p.opendota)}" target="_blank" rel="noreferrer">OpenDota</a>
        <a href="${escapeHtml(p.dotabuff)}" target="_blank" rel="noreferrer">Dotabuff</a>
        <a href="${escapeHtml(p.steam)}" target="_blank" rel="noreferrer">Steam</a>
      </li>`,
    ).join("")}</ul>
    <form method="post" action="/settings/dota">
      <h3>Shown account per channel</h3>
      <p class="muted"><code>!mmr</code> <code>!wl</code> <code>!lastgame</code> <code>!medal</code> <code>!dota</code> use this account on that Kick channel. <code>do not show</code> stays silent. Override in chat with <code>!mmr smurf</code> etc.</p>
      <ul class="list">${listed
        .map((slug) => {
          const selected = settings.dotaShownByChannel?.[slug] || defaultShownKey(slug);
          return `<li>
            <span class="grow"><a href="https://kick.com/${escapeHtml(slug)}" target="_blank" rel="noreferrer">${escapeHtml(slug)}</a></span>
            <select name="shown_${escapeHtml(slug)}">
              <option value="off"${selected === "off" ? " selected" : ""}>do not show</option>
              ${DOTA_PROFILES.map(
                (p) =>
                  `<option value="${escapeHtml(p.key)}"${p.key === selected ? " selected" : ""}>${escapeHtml(p.who)}</option>`,
              ).join("")}
            </select>
          </li>`;
        })
        .join("")}</ul>
      <div class="row"><button type="submit">Save shown accounts</button></div>
    </form>
    <p class="muted">Steam in-game status: ${
      steamApiKeyConfigured()
        ? '<span class="ok">STEAM_API_KEY set</span>'
        : '<span class="warn">no STEAM_API_KEY</span>'
    }. Register at <a href="https://steamcommunity.com/dev/apikey" target="_blank" rel="noreferrer">steamcommunity.com/dev/apikey</a>. Domain Name: <code>localhost</code> (Steam does not verify it). Check the terms, Register, then put the key in <code>.env</code> as <code>STEAM_API_KEY=</code>. Last-match data works without it.</p>
    <div class="row">
      <a class="btn" href="/say-test">Send test message</a>
      <a class="btn ghost" href="/login">Authorize streamer</a>
      <a class="btn ghost" href="/login-bot">Authorize bot account</a>
    </div>
  </div>
  <div class="stack-col">
  <div class="card">
    <h2>Channels</h2>
    <ul class="list">${channelRows || "<li class='muted'>None yet — authorize the streamer account first.</li>"}</ul>
    <form class="inline" method="post" action="/channels">
      <input type="text" name="slug" placeholder="kick.com/username or username" required>
      <button type="submit">Add channel</button>
    </form>
    <p class="muted">CamelBot checks Kick that the username exists before adding. Home stays.</p>
  </div>
  <div class="card">
    <h2>Chat</h2>
    <p class="muted">Live only: joins conversation, idle lines (5–10 min quiet, stops if the last 5 messages are CamelBot), quiz, timed messages. Offline: home channel still answers if you @CamelBot, say bot/mods, or keep talking to it. Extra channels stay silent while offline except Dota commands (<code>!mmr</code> <code>!wl</code> <code>!lastgame</code> <code>!medal</code> <code>!dota</code>) which always work. From home chat you can tell CamelBot to join a <em>registered</em> extra channel and post there, or raid/host any Kick channel (does not need to be in the list). You can also say things like <code>clear the chat</code> or <code>şarkıyı geç</code>.</p>
  </div>
  </div>
  </div>`;
}

async function discordBody(): Promise<string> {
  const d = await discordStatus();
  const routing = getDiscordRouting();
  const fmt = (iso: string | null) => (iso ? formatAnkaraShort(new Date(iso)) : "—");

  const routeStatusRows =
    d.routes.length > 0
      ? d.routes
          .map((r) => {
            const postSame = r.postChannelId === r.listenChannelId;
            const listen = r.listenName ? `#${r.listenName}` : r.listenChannelId;
            const post = postSame
              ? "same as listen"
              : r.postName
                ? `#${r.postName}`
                : r.postChannelId;
            const guild = r.guildName ?? r.guildId;
            return `<p class="route-status"><span class="k">Route:</span> ${escapeHtml(guild)} · listen ${escapeHtml(listen)} → post ${escapeHtml(String(post))}</p>`;
          })
          .join("")
      : '<p class="route-status"><span class="warn">No routes configured</span></p>';

  const knownRows = Object.entries(DISCORD_IDENTITIES)
    .map(
      ([id, row]) => `<tr>
        <td><code>${escapeHtml(id)}</code></td>
        <td><strong>${escapeHtml(row.label)}</strong>${row.isKing ? ' <span class="tag">king</span>' : ""}</td>
        <td class="muted">${escapeHtml(row.seedSummary.slice(0, 120))}</td>
      </tr>`,
    )
    .join("");

  const inviteUrl = discordInviteUrl();
  const kingId = discordKingUserId();
  const initialRoutes = JSON.stringify(routing.routes);
  const initialAlwaysReply = JSON.stringify(
    d.alwaysReplyUsers.map((u) => ({
      id: u.id,
      label: u.label.trim() || u.displayName || "",
    })),
  );
  const guildOptionsJson = JSON.stringify(d.guildOptions);
  const channelsByGuildJson = JSON.stringify(d.channelsByGuild);
  const voiceChannelsByGuildJson = JSON.stringify(d.voiceChannelsByGuild);
  const voiceMetaJson = JSON.stringify({
    voiceId: d.voice.voiceId,
    model: d.voice.model,
    voices: d.voice.voices,
    sessions: d.voice.sessions,
    stt: d.voice.stt,
    tts: d.voice.tts,
    sttProvider: d.voice.sttProvider,
    ttsProvider: d.voice.ttsProvider,
  });
  const sessionHint = d.voice.sessions[0]
    ? `${d.voice.sessions.length} joined`
    : "none";
  const accessWarnings = d.routes
    .filter((r) => d.ready && (!r.listenName || !r.postName))
    .map((r) => {
      const parts = [];
      if (!r.listenName) parts.push(`listen ${r.listenChannelId}`);
      if (!r.postName) parts.push(`post ${r.postChannelId}`);
      return `<p class="route-status"><span class="warn">Missing Access</span> — bot cannot see ${escapeHtml(parts.join(" / "))} in ${escapeHtml(r.guildName ?? r.guildId)}. Fix channel permissions or pick another channel.</p>`;
    })
    .join("");

  return `
  <div class="card">
    <div class="card-head">
      <h2>Discord</h2>
      <div class="row">
        ${inviteUrl ? `<a class="btn" href="/discord/invite" target="_blank" rel="noreferrer">Invite bot to server</a>` : `<span class="warn">Set DISCORD_CLIENT_ID in .env to invite</span>`}
        <a class="btn ghost" href="/discord">Refresh</a>
      </div>
    </div>
    <div class="grid">
      <p>Token: ${d.configured ? '<span class="ok">set in .env</span>' : '<span class="warn">DISCORD_BOT_TOKEN missing</span>'}</p>
      <p>Connection: ${d.ready ? `<span class="ok">online${d.tag ? ` — ${escapeHtml(d.tag)}` : ""}</span>` : '<span class="warn">offline — run npm run dev</span>'}</p>
      <p>AI replies: ${anyAiConfigured() ? '<span class="ok">ready</span>' : '<span class="warn">no AI keys in .env</span>'}</p>
      <p>Voice STT: ${d.voice.stt ? `<span class="ok">${escapeHtml(d.voice.sttProvider || "ready")}</span>` : '<span class="warn">need GROQ_API_KEY (free Whisper)</span>'}</p>
      <p>Voice TTS: <span class="ok">${escapeHtml(d.voice.ttsProvider || "Edge TTS (free)")}</span> · ${escapeHtml(d.voice.voiceId)}</p>
      <p>In voice: ${d.voice.sessions.length ? `<span class="ok">${escapeHtml(sessionHint)}</span>` : '<span class="muted">none — join below</span>'}</p>
      <p>Routes: ${d.routes.length ? `<span class="ok">${d.routes.length} active</span>` : '<span class="muted">none — add below (bot still connects)</span>'}</p>
      <p>Always reply: ${d.alwaysReplyUserIds.length ? `<span class="ok">${d.alwaysReplyUserIds.length} users</span>` : '<span class="muted">none</span>'}</p>
      <p>Messages seen: ${d.messagesSeen} · Replies sent: ${d.repliesSent}</p>
      <p>Last message: ${escapeHtml(fmt(d.lastMessageAt))} · Last reply: ${escapeHtml(fmt(d.lastReplyAt))}</p>
      ${d.ready && !d.guildOptions.length ? '<p style="grid-column:1/-1" class="warn">Bot is online but not in any servers. Use Invite bot to server, then refresh.</p>' : ""}
      ${!d.ready && d.configured ? '<p style="grid-column:1/-1" class="muted">Waiting for Discord login… if this stays offline, restart <code>npm run dev</code> (only one copy).</p>' : ""}
      ${routeStatusRows}
      ${accessWarnings}
    </div>

    <h3>Voice panel</h3>
    <p class="muted">Join a Discord voice channel from here, pick a TTS voice, and test how CamelBot sounds in your browser (and optionally in the call).</p>
    <div class="add-row" id="voicePanelRow">
      <label>Server
        <select id="voiceGuildPick"><option value="">— pick server —</option></select>
      </label>
      <label>Voice channel
        <select id="voiceChannelPick"><option value="">— pick voice —</option></select>
      </label>
      <label>Transcript text channel
        <select id="voiceTextPick"><option value="">— auto from routes —</option></select>
      </label>
    </div>
    <div class="row" style="margin-top:.55rem">
      <button type="button" class="btn" id="voiceJoinBtn">Join voice</button>
      <button type="button" class="btn ghost" id="voiceLeaveBtn">Leave voice</button>
      <span class="muted" id="voiceJoinStatus"></span>
    </div>
    <div class="add-row" style="margin-top:.85rem">
      <label>Speaking voice
        <select id="ttsVoicePick"></select>
      </label>
      <label>TTS model
        <select id="ttsModelPick">
          <option value="tts-1">tts-1 (fast)</option>
          <option value="tts-1-hd">tts-1-hd (clearer)</option>
        </select>
      </label>
      <button type="button" class="btn ghost" id="ttsSaveBtn">Save voice</button>
    </div>
    <h3>Test voice</h3>
    <p class="muted">Type a line, hit <strong>Play in browser</strong> to hear it here. Optionally also play it in the Discord call if the bot is joined.</p>
    <textarea id="voiceTestText" placeholder="Merhaba chat, ben CamelBot." style="min-height:3.2rem"></textarea>
    <div class="row">
      <button type="button" class="btn" id="voiceTestBrowserBtn">Play in browser</button>
      <button type="button" class="btn ghost" id="voiceTestDiscordBtn">Play in Discord call</button>
      <span class="muted" id="voiceTestStatus"></span>
    </div>
    <audio id="voiceTestPlayer" controls style="width:100%;margin-top:.65rem"></audio>

    <form class="stack" id="discordForm" method="post" action="/discord/settings">
      <input type="hidden" name="routesJson" id="routesJson">
      <input type="hidden" name="alwaysReplyJson" id="alwaysReplyJson">

      <h3>Listen / post routes</h3>
      <p class="muted">Pick a server and listen channel, then click <strong>Add route</strong> — it saves immediately (no extra Save click). Remove also saves right away.</p>
      <div class="add-row" id="routeAddRow">
        <label>Server
          <select id="routeGuildPick"><option value="">— pick server —</option></select>
        </label>
        <label>Listen channel
          <select id="routeListenPick"><option value="">— pick channel —</option></select>
        </label>
        <label>Post channel
          <select id="routePostPick"><option value="">Same as listen</option></select>
        </label>
        <button type="button" class="btn" id="routeAddBtn">Add route</button>
      </div>
      <div class="add-row">
        <label>Or server ID
          <input type="text" id="routeGuildManual" placeholder="145547351451369472">
        </label>
        <label>Or listen ID
          <input type="text" id="routeListenManual" placeholder="453591795620904980">
        </label>
        <label>Or post ID
          <input type="text" id="routePostManual" placeholder="leave empty = same">
        </label>
      </div>
      <ul class="item-list" id="routeList"></ul>

      <h3>Always reply users</h3>
      <p class="muted">These users get a reply even without saying camel/bot. Everyone else (including you) needs a keyword, @mention, reply, or a 15s follow-up after the bot last spoke.</p>
      <div class="add-row">
        <label>Discord user ID
          <input type="text" id="alwaysIdInput" placeholder="145668146143952896">
        </label>
        <label>Nickname <span class="muted">(optional — auto from Discord)</span>
          <input type="text" id="alwaysLabelInput" placeholder="auto-fill from Discord">
        </label>
        <button type="button" class="btn" id="alwaysAddBtn">Add user</button>
      </div>
      <ul class="item-list" id="alwaysList"></ul>

      <h3>Known people</h3>
      <table class="facts" style="width:100%;margin:.5rem 0 1rem">
        <tr><th>Discord ID</th><th>Name</th><th>Notes</th></tr>
        ${knownRows}
      </table>
      <p>King (static): <code>${escapeHtml(discordKingUserId())}</code> — <strong>mcvckaharamamm</strong> <span class="muted">(${escapeHtml(DISCORD_KING_ID)})</span></p>
      <div class="row">
        <button type="submit">Save</button>
      </div>
    </form>
    <p class="muted"><strong>Free path:</strong> STT = Groq Whisper (<code>GROQ_API_KEY</code>). TTS = Microsoft Edge neural voices (no credits). OpenAI voices in the picker need billed API credits.</p>
    <p class="muted">Bot needs <strong>View Channel</strong>, <strong>Send Messages</strong>, <strong>Read Message History</strong>, <strong>Connect</strong> + <strong>Speak</strong> for voice, plus <strong>Move / Mute / Deafen / Kick / Ban / Timeout Members</strong> for staff orders. Re-invite with the button if a command says missing permission. Discord now requires DAVE encryption — if join keeps timing out, use <strong>Node 22+</strong>.</p>
    <p class="muted">Wake with <strong>camel</strong> / <strong>camelbot</strong> / <strong>bot</strong> (text or voice). Staff examples: <em>bot move me to General</em>, <em>bot move us to chill</em>, <em>bot mute @user</em>, <em>bot kick @user from voice</em>. From Kick: <em>benim olduğum DC kanalına gir ve selam de</em>. Kick stream orders from Discord still need a wake word.</p>
    <p class="muted">Use <strong>Invite bot to server</strong> to add AmqKeliBot to another Discord server, then refresh this page and pick that server from the dropdown.</p>
  </div>
  <script>
  (() => {
    const guildOptions = ${guildOptionsJson};
    const channelsByGuild = ${channelsByGuildJson};
    const voiceChannelsByGuild = ${voiceChannelsByGuildJson};
    const voiceMeta = ${voiceMetaJson};
    const KING_ID = ${JSON.stringify(kingId)};
    let routes = ${initialRoutes};
    let alwaysReply = ${initialAlwaysReply};

    const routeList = document.getElementById("routeList");
    const alwaysList = document.getElementById("alwaysList");
    const routesJson = document.getElementById("routesJson");
    const alwaysReplyJson = document.getElementById("alwaysReplyJson");
    const guildPick = document.getElementById("routeGuildPick");
    const listenPick = document.getElementById("routeListenPick");
    const postPick = document.getElementById("routePostPick");
    const guildManual = document.getElementById("routeGuildManual");
    const listenManual = document.getElementById("routeListenManual");
    const postManual = document.getElementById("routePostManual");
    const alwaysIdInput = document.getElementById("alwaysIdInput");
    const alwaysLabelInput = document.getElementById("alwaysLabelInput");
    const form = document.getElementById("discordForm");

    function guildName(id) {
      return guildOptions.find((g) => g.id === id)?.name ?? id;
    }

    function channelName(guildId, channelId) {
      const rows = channelsByGuild[guildId] ?? [];
      return rows.find((c) => c.id === channelId)?.name ?? channelId;
    }

    function fillGuildSelect() {
      guildPick.innerHTML = '<option value="">— pick server —</option>' +
        guildOptions.map((g) => '<option value="' + g.id + '">' + g.name + ' (' + g.id + ')</option>').join("");
    }

    function fillChannelSelects(guildId) {
      const rows = channelsByGuild[guildId] ?? [];
      const opts = rows.map((c) => '<option value="' + c.id + '">' + c.name + ' (' + c.id + ')</option>').join("");
      listenPick.innerHTML = '<option value="">— pick channel —</option>' + opts;
      postPick.innerHTML = '<option value="">Same as listen</option>' + opts;
    }

    function syncHidden() {
      routesJson.value = JSON.stringify(routes);
      alwaysReplyJson.value = JSON.stringify(alwaysReply);
    }

    async function persistDiscord() {
      syncHidden();
      try {
        const res = await fetch("/discord/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ routes, alwaysReply }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.ok === false) {
          alert(data.error || "Could not save Discord settings.");
          return false;
        }
        return true;
      } catch (err) {
        alert("Could not save Discord settings.");
        return false;
      }
    }

    function renderRoutes() {
      syncHidden();
      if (!routes.length) {
        routeList.innerHTML = '<li class="muted">No routes yet — Discord replies off after save.</li>';
        return;
      }
      routeList.innerHTML = routes.map((r, i) => {
        const postId = r.postChannelId || r.listenChannelId;
        const postLabel = postId === r.listenChannelId
          ? "same as listen"
          : channelName(r.guildId, postId);
        return '<li><span class="grow"><strong>' + guildName(r.guildId) + '</strong> · listen ' +
          channelName(r.guildId, r.listenChannelId) + ' → post ' + postLabel + '</span>' +
          '<button type="button" class="danger" data-route="' + i + '">Remove</button></li>';
      }).join("");
      routeList.querySelectorAll("[data-route]").forEach((btn) => {
        btn.addEventListener("click", () => {
          routes.splice(Number(btn.getAttribute("data-route")), 1);
          renderRoutes();
          void persistDiscord();
        });
      });
    }

    function renderAlwaysReply() {
      syncHidden();
      if (!alwaysReply.length) {
        alwaysList.innerHTML = '<li class="muted">None — everyone needs camel/bot, @mention, or a follow-up.</li>';
        return;
      }
      alwaysList.innerHTML = alwaysReply.map((u, i) => {
        const name = u.label || u.id;
        return '<li><span class="grow"><code>' + u.id + '</code> · <strong>' + name + '</strong></span>' +
          '<button type="button" class="danger" data-always="' + i + '">Remove</button></li>';
      }).join("");
      alwaysList.querySelectorAll("[data-always]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const idx = Number(btn.getAttribute("data-always"));
          alwaysReply.splice(idx, 1);
          renderAlwaysReply();
          void persistDiscord();
        });
      });
    }

    guildPick.addEventListener("change", () => fillChannelSelects(guildPick.value));

    document.getElementById("routeAddBtn").addEventListener("click", () => {
      const guildId = guildPick.value || guildManual.value.trim();
      const listenChannelId = listenPick.value || listenManual.value.trim();
      const postChannelId = postPick.value || postManual.value.trim();
      if (!guildId || !listenChannelId) {
        alert("Pick or paste a server ID and listen channel ID.");
        return;
      }
      const dup = routes.some((r) => r.guildId === guildId && r.listenChannelId === listenChannelId);
      if (dup) {
        alert("That listen channel is already in the list.");
        return;
      }
      routes.push({ guildId, listenChannelId, postChannelId });
      guildManual.value = "";
      listenManual.value = "";
      postManual.value = "";
      renderRoutes();
      void persistDiscord();
    });

    document.getElementById("alwaysAddBtn").addEventListener("click", async () => {
      const id = alwaysIdInput.value.trim();
      let label = alwaysLabelInput.value.trim();
      if (!/^\\d{15,22}$/.test(id)) {
        alert("Enter a valid Discord user ID (15–22 digits).");
        return;
      }
      if (alwaysReply.some((u) => u.id === id)) {
        alert("That user is already in the list.");
        return;
      }
      if (!label) {
        try {
          const res = await fetch("/discord/user/" + encodeURIComponent(id));
          const data = await res.json();
          if (data && data.displayName) label = data.displayName;
        } catch (_) {}
      }
      alwaysReply.push({ id, label });
      alwaysIdInput.value = "";
      alwaysLabelInput.value = "";
      renderAlwaysReply();
      void persistDiscord();
    });

    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const guildId = guildPick.value || guildManual.value.trim();
      const listenChannelId = listenPick.value || listenManual.value.trim();
      const postChannelId = postPick.value || postManual.value.trim();
      if (guildId && listenChannelId && !routes.some((r) => r.guildId === guildId && r.listenChannelId === listenChannelId)) {
        routes.push({ guildId, listenChannelId, postChannelId });
        renderRoutes();
      }
      void persistDiscord().then((ok) => {
        if (ok) window.location.href = "/discord?notice=" + encodeURIComponent("Discord settings saved.");
      });
    });

    fillGuildSelect();
    const presetGuild = routes[0]?.guildId || guildOptions[0]?.id || "";
    if (presetGuild) guildPick.value = presetGuild;
    fillChannelSelects(guildPick.value);
    renderRoutes();
    renderAlwaysReply();

    // --- Voice panel ---
    function esc(s) {
      return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    }
    const voiceGuild = document.getElementById("voiceGuildPick");
    const voiceChannel = document.getElementById("voiceChannelPick");
    const voiceText = document.getElementById("voiceTextPick");
    const ttsVoice = document.getElementById("ttsVoicePick");
    const ttsModel = document.getElementById("ttsModelPick");
    const joinStatus = document.getElementById("voiceJoinStatus");
    const testStatus = document.getElementById("voiceTestStatus");
    const testPlayer = document.getElementById("voiceTestPlayer");
    const testText = document.getElementById("voiceTestText");

    function fillVoiceGuild() {
      voiceGuild.innerHTML = '<option value="">— pick server —</option>' +
        guildOptions.map((g) => '<option value="' + g.id + '">' + esc(g.name) + '</option>').join("");
    }
    function fillVoiceChannels(guildId) {
      const vcs = voiceChannelsByGuild[guildId] || [];
      const texts = channelsByGuild[guildId] || [];
      voiceChannel.innerHTML = '<option value="">— pick voice —</option>' +
        vcs.map((c) => '<option value="' + c.id + '">' + esc(c.name) + '</option>').join("");
      voiceText.innerHTML = '<option value="">— auto from routes —</option>' +
        texts.map((c) => '<option value="' + c.id + '">' + esc(c.name) + '</option>').join("");
      const sess = (voiceMeta.sessions || []).find((s) => s.guildId === guildId);
      if (sess) {
        voiceChannel.value = sess.voiceChannelId;
        if (sess.textChannelId) voiceText.value = sess.textChannelId;
      }
    }
    function fillTtsVoices() {
      ttsVoice.innerHTML = (voiceMeta.voices || []).map((v) =>
        '<option value="' + v.id + '"' + (v.id === voiceMeta.voiceId ? " selected" : "") + ">" + esc(v.label) + "</option>"
      ).join("");
      ttsModel.value = voiceMeta.model || "tts-1";
    }
    async function postJson(url, body) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("audio/")) return { ok: res.ok, audio: await res.arrayBuffer(), status: res.status };
      const data = await res.json().catch(() => ({ ok: false, error: "Bad response" }));
      return { ...data, ok: res.ok && data.ok !== false, status: res.status };
    }

    voiceGuild.addEventListener("change", () => fillVoiceChannels(voiceGuild.value));
    fillVoiceGuild();
    fillTtsVoices();
    const vg = (voiceMeta.sessions && voiceMeta.sessions[0]?.guildId) || routes[0]?.guildId || guildOptions[0]?.id || "";
    if (vg) {
      voiceGuild.value = vg;
      fillVoiceChannels(vg);
    }

    document.getElementById("voiceJoinBtn").addEventListener("click", async () => {
      joinStatus.textContent = "Joining…";
      const data = await postJson("/discord/voice/join", {
        guildId: voiceGuild.value,
        voiceChannelId: voiceChannel.value,
        textChannelId: voiceText.value,
      });
      joinStatus.textContent = data.ok ? ("Joined " + (data.channelName || "voice")) : (data.error || "Join failed");
      if (data.ok) joinStatus.className = "ok";
      else joinStatus.className = "warn";
    });
    document.getElementById("voiceLeaveBtn").addEventListener("click", async () => {
      joinStatus.textContent = "Leaving…";
      const data = await postJson("/discord/voice/leave", { guildId: voiceGuild.value });
      joinStatus.textContent = data.ok ? "Left voice." : (data.error || "Leave failed");
      joinStatus.className = data.ok ? "muted" : "warn";
    });
    document.getElementById("ttsSaveBtn").addEventListener("click", async () => {
      const data = await postJson("/discord/voice/prefs", { voice: ttsVoice.value, model: ttsModel.value });
      joinStatus.textContent = data.ok ? ("Saved voice: " + ttsVoice.value) : (data.error || "Save failed");
      joinStatus.className = data.ok ? "ok" : "warn";
      if (data.ok && data.prefs) {
        voiceMeta.voiceId = data.prefs.voice;
        voiceMeta.model = data.prefs.model;
      }
    });

    async function runVoiceTest(playInDiscord) {
      const text = (testText.value || "").trim();
      if (!text) {
        testStatus.textContent = "Enter text first.";
        testStatus.className = "warn";
        return;
      }
      testStatus.textContent = "Generating…";
      testStatus.className = "muted";
      try {
        const res = await fetch("/discord/voice/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            voice: ttsVoice.value,
            playInDiscord: Boolean(playInDiscord),
            guildId: voiceGuild.value,
          }),
        });
        const ct = res.headers.get("content-type") || "";
        if (!res.ok || !ct.includes("audio/")) {
          const data = await res.json().catch(() => ({}));
          testStatus.textContent = data.error || ("Failed (" + res.status + ")");
          testStatus.className = "warn";
          return;
        }
        const buf = await res.arrayBuffer();
        const url = URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" }));
        testPlayer.src = url;
        void testPlayer.play().catch(() => {});
        testStatus.textContent = playInDiscord ? "Playing in Discord + browser." : "Playing in browser.";
        testStatus.className = "ok";
      } catch (err) {
        testStatus.textContent = err && err.message ? err.message : "Test failed";
        testStatus.className = "warn";
      }
    }
    document.getElementById("voiceTestBrowserBtn").addEventListener("click", () => void runVoiceTest(false));
    document.getElementById("voiceTestDiscordBtn").addEventListener("click", () => void runVoiceTest(true));
  })();
  </script>`;
}

function commandsBody(): string {
  const prefix = config.bot.prefix;
  const noAuto = new Set(["skip", "sr", "rewardadd", "points", "draw", "poll", "vote", "emoteonly", "slow", "followonly", "subonly", "clear", "clip"]);
  const builtinRows = BUILTIN_COMMANDS.map((c) => {
    const who = getAccess(c.name);
    return `<li>
      <code>${escapeHtml(prefix + c.name)}</code>
      <span class="grow">${escapeHtml(c.what)}</span>
      ${whoForm(`/commands/access`, c.name, who)}
      ${noAuto.has(c.name) ? "" : timerForm("/commands/timer", `<input type="hidden" name="name" value="${escapeHtml(c.name)}">`, getCommandTimer(c.name))}
    </li>`;
  }).join("");
  const customRows = listCustomCommands()
    .map(
      (c) => `<li>
        <code>${escapeHtml(prefix + c.name)}</code>
        <span class="grow">${escapeHtml(c.response)}</span>
        ${whoForm("/commands/custom-access", c.name, c.who)}
        ${timerForm("/commands/timer", `<input type="hidden" name="name" value="${escapeHtml(c.name)}">`, getCommandTimer(c.name))}
        <form method="post" action="/commands/remove"><input type="hidden" name="name" value="${escapeHtml(c.name)}"><button class="danger" type="submit">Remove</button></form>
      </li>`,
    )
    .join("");
  const timedRows = listTimedCommands()
    .map(
      (c) => `<li>
        <span class="grow">${escapeHtml(c.text)}</span>
        ${c.enabled ? '<span class="tag">on</span>' : '<span class="tag dim">off</span>'}
        ${timerForm("/commands/timed/interval", `<input type="hidden" name="id" value="${escapeHtml(c.id)}">`, c.enabled ? c.minutes : null)}
        <form method="post" action="/commands/timed/remove"><input type="hidden" name="id" value="${escapeHtml(c.id)}"><button class="danger" type="submit">Remove</button></form>
      </li>`,
    )
    .join("");

  return `
  <div class="split">
  <div class="card">
    <h2>Built-in commands</h2>
    <p class="muted">Change who can use each command and whether CamelBot auto-posts it. Timers default to no timer. !title defaults to mods. !draw posts a free image link in chat.</p>
    <ul class="list">${builtinRows}</ul>
  </div>
  <div class="stack-col">
  <div class="card">
    <h2>Custom commands</h2>
    <ul class="list">${customRows || "<li class='muted'>None yet</li>"}</ul>
    <form class="stack" method="post" action="/commands">
      <input type="text" name="name" placeholder="discord" required>
      <textarea name="response" placeholder="Join the Discord: ... Use {user} to mention them." required></textarea>
      <div class="who">${whoSelect("everyone")}<button type="submit">Add command</button></div>
    </form>
  </div>
  <div class="card">
    <h2>Timed messages</h2>
    <p class="muted">CamelBot posts these on the home channel every X minutes while live (or while the offline-testing toggle is on).</p>
    <ul class="list">${timedRows || "<li class='muted'>None yet</li>"}</ul>
    <form class="stack" method="post" action="/commands/timed">
      <textarea name="text" placeholder="Follow for sub goals / Discord / !sr" required></textarea>
      <div class="inline timer" style="margin:0">
        ${timerSelect(15)}
        <button type="submit">Add timed message</button>
      </div>
    </form>
  </div>
  </div>
  </div>`;
}

function pageSlice<T>(items: T[], page: number): { rows: T[]; page: number; pages: number; total: number } {
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(page, pages);
  const start = (current - 1) * PAGE_SIZE;
  return { rows: items.slice(start, start + PAGE_SIZE), page: current, pages, total };
}

function pager(base: string, page: number, pages: number, total: number): string {
  if (total === 0) return "";
  const prev = page <= 1 ? "off" : "";
  const next = page >= pages ? "off" : "";
  return `<div class="pager">
    <a class="btn ghost ${prev}" href="${base}?p=${page - 1}">Prev</a>
    <span class="muted">Page ${page} / ${pages} · ${total}</span>
    <a class="btn ghost ${next}" href="${base}?p=${page + 1}">Next</a>
  </div>`;
}

function modBody(page: number): string {
  const all = listModLog(200);
  const sliced = pageSlice(all, page);
  const rows = sliced.rows
    .map((e) => {
      const said = e.message
        ? `<div class="said">Said: ${escapeHtml(e.message)}</div>`
        : "";
      return `<li style="align-items:flex-start">
        <form method="post" action="/mod/remove">
          <input type="hidden" name="id" value="${escapeHtml(e.id)}">
          <input type="hidden" name="page" value="${sliced.page}">
          <button class="danger-log" type="submit">Delete</button>
        </form>
        <span class="grow">
          <code>${escapeHtml(formatAnkaraShort(e.at))}</code>
          <strong>@${escapeHtml(e.username)}</strong> — ${escapeHtml(e.reason)}${e.detail ? ` <span class="muted">(${escapeHtml(e.detail)})</span>` : ""}
          ${said}
        </span>
      </li>`;
    })
    .join("");
  return `
  <div class="card tall-card">
    <div class="card-head">
      <h2>Mod log</h2>
      <a class="btn" href="/mod?p=${sliced.page}">Refresh</a>
    </div>
    <p class="muted">Deletes, warnings, timeouts, and bans CamelBot performed. Times are Ankara.</p>
    <div class="list-scroll">
      <ul class="list">${rows || "<li class='muted'>Nothing yet. Auto-mod actions will show up here.</li>"}</ul>
    </div>
    ${pager("/mod", sliced.page, sliced.pages, sliced.total)}
  </div>`;
}

function memoryBody(page: number): string {
  const sliced = pageSlice(listPeople(), page);
  const rooms = listChatSummaries();
  const extras = extraChannels();
  const homeSlug = liveChatChannels[0] ?? "mcvckaharamamm";
  const roomLabel = (channelId: number): string => {
    if (channelId === KING_ID) return homeSlug;
    return extras.find((c) => c.userId === channelId)?.slug ?? `channel ${channelId}`;
  };
  const roomRows = rooms.length
    ? rooms
        .map((r) => {
          const when = r.lastSummaryAt
            ? ` · updated ${escapeHtml(formatAnkaraShort(r.lastSummaryAt))}`
            : "";
          const note = r.summary
            ? escapeHtml(r.summary)
            : "<span class='muted'>Not enough chat yet — updates after 10 messages.</span>";
          return `<li style="align-items:flex-start">
            <span class="grow">
              <strong>${escapeHtml(roomLabel(r.channelId))}</strong>
              ${channelIdTag(r.channelId, extras)}
              <span class="muted">${when}</span>
              <div>${note}</div>
            </span>
          </li>`;
        })
        .join("")
    : "<li class='muted'>No room summary yet. CamelBot writes one after 10 chat lines.</li>";
  const rows = sliced.rows
    .map((p) => {
      const you = p.userId === KING_ID;
      const nick = p.nick && p.nick !== p.username ? ` · nick ${escapeHtml(p.nick)}` : "";
      const bio = p.bio ? `<div class="muted">Bio: ${escapeHtml(p.bio)}</div>` : "";
      const note = p.summary
        ? escapeHtml(p.summary)
        : "<span class='muted'>No summary yet — appears after they talk with CamelBot.</span>";
      return `<li style="align-items:flex-start">
        <span class="grow">
          <strong>@${escapeHtml(p.username)}</strong>${you ? ' <span class="tag">you</span>' : ""}
          <span class="muted">${nick} · last ${escapeHtml(formatAnkaraShort(p.lastAt))}</span>
          ${bio}
          <div>${note}</div>
        </span>
      </li>`;
    })
    .join("");
  return `
  <div class="card tall-card">
    <div class="card-head">
      <h2>Memory</h2>
      <a class="btn" href="/memory?p=${sliced.page}">Refresh</a>
    </div>
    <p class="muted">Room summary of what chat is talking about, plus short notes per person (Kick nick, bio, chats with the bot). Person notes appear after 5 real chat lines.</p>
    <h3>Chat summary</h3>
    <ul class="list">${roomRows}</ul>
    <h3>People</h3>
    <div class="list-scroll">
      <ul class="list">${rows || "<li class='muted'>Nobody remembered yet. Notes appear after CamelBot talks with someone.</li>"}</ul>
    </div>
    ${pager("/memory", sliced.page, sliced.pages, sliced.total)}
  </div>`;
}

function channelIdTag(channelId: number, extras: Array<{ slug: string; userId?: number }>): string {
  if (channelId === KING_ID) return ' <span class="tag">home</span>';
  if (extras.some((c) => c.userId === channelId)) return ' <span class="tag dim">extra</span>';
  return "";
}

function recapBody(): string {
  const s = recapSnapshot();
  const event = (label: string, username?: string, extra?: string, at?: number) => {
    if (!username) return `<p><span class="k">${escapeHtml(label)}</span> —</p>`;
    const when = at ? ` · ${escapeHtml(formatRecapAgo(at))}` : "";
    return `<p><span class="k">${escapeHtml(label)}</span> <strong>@${escapeHtml(username)}</strong>${extra ? escapeHtml(extra) : ""}<span class="muted">${when}</span></p>`;
  };
  const chatterRows = s.topChatters
    .map(
      (c, i) =>
        `<li><code>#${i + 1}</code><span class="grow">@${escapeHtml(c.username)}</span><span class="muted">${c.lines} lines${c.emotes ? ` · ${c.emotes} emotes` : ""}</span></li>`,
    )
    .join("");
  const gameRows = s.games
    .map(
      (g) =>
        `<li><span class="grow">${escapeHtml(g.name)}${g.current ? ' <span class="tag">now</span>' : ""}</span><span class="muted">${escapeHtml(formatRecapDur(g.ms))}</span></li>`,
    )
    .join("");
  const moodClass = s.mood.score >= 12 ? "ok" : s.mood.score <= -12 ? "warn" : "";
  const subExtra = s.lastSub?.months && s.lastSub.months > 1 ? ` (${s.lastSub.months} mo)` : "";
  const donExtra = s.lastDonation?.amount
    ? ` ${s.lastDonation.amount}`
    : s.lastDonation?.kicks
      ? ` ${s.lastDonation.kicks} kicks`
      : "";
  const raidExtra = s.lastRaid?.viewers ? ` · ${s.lastRaid.viewers} viewers` : "";
  return `
  <div class="split">
  <div class="stack-col">
  <div class="card">
    <div class="card-head">
      <h2>Recap</h2>
      <div class="row" style="margin:0">
        <a class="btn" href="/recap">Refresh</a>
        <form method="post" action="/recap/reset" style="margin:0">
          <button class="btn danger" type="submit">Reset this stream</button>
        </form>
      </div>
    </div>
    <p class="mood ${moodClass}">Mood: ${escapeHtml(s.mood.label)} (${s.mood.score})</p>
    <p class="muted">Updates from home-channel chat, follows, subs, donations, raids, and emotes. Best/worst shift with messages and mood. Last events stay across streams; chat/emote/game counts reset when a new live session starts (or you hit reset).</p>
    <div class="facts">
      ${event("Last follow", s.lastFollow?.username, "", s.lastFollow?.at)}
      ${event("Last sub", s.lastSub?.username, subExtra, s.lastSub?.at)}
      ${event("Last donation", s.lastDonation?.username, donExtra, s.lastDonation?.at)}
      ${event("Last raid", s.lastRaid?.username, raidExtra, s.lastRaid?.at)}
    </div>
    <p style="margin-top:.7rem"><span class="k">Last wrote to bot</span> ${
      s.lastTalk
        ? `<strong>@${escapeHtml(s.lastTalk.username)}</strong><span class="muted"> · ${escapeHtml(formatRecapAgo(s.lastTalk.at))}</span>`
        : "—"
    }</p>
    ${s.lastTalk?.text ? `<div class="said-full">${escapeHtml(s.lastTalk.text)}</div>` : ""}
  </div>
  <div class="card">
    <h2>Best / worst</h2>
    <p><span class="k">Best person</span> <strong class="who-best">@${escapeHtml(s.best.username)}</strong></p>
    <p class="why">${escapeHtml(s.best.why)}</p>
    <p><span class="k">Worst person</span> <strong class="who-worst">@${escapeHtml(s.worst.username)}</strong></p>
    <p class="why">${escapeHtml(s.worst.why)}</p>
    <p><span class="k">Top emote spam</span> ${
      s.emoteSpammer
        ? `<strong>@${escapeHtml(s.emoteSpammer.username)}</strong> · ${escapeHtml(s.emoteSpammer.emote)} (${s.emoteSpammer.count}x)`
        : "—"
    }</p>
  </div>
  </div>
  <div class="stack-col">
  <div class="card">
    <h2>Top chatters this stream</h2>
    <ul class="list">${chatterRows || "<li class='muted'>No chat counted yet. Talk in the home channel while live.</li>"}</ul>
  </div>
  <div class="card">
    <h2>Games this stream</h2>
    <ul class="list">${gameRows || "<li class='muted'>No category recorded yet. Goes live when the stream is on.</li>"}</ul>
  </div>
  </div>
  </div>`;
}

function emotesBody(): string {
  const rows = listEmotesForUi();
  const overrides = getEmoteMoodOverrides();
  const counts: Record<string, number> = {};
  for (const mood of EMOTE_MOODS) counts[mood] = 0;
  for (const row of rows) counts[row.mood] = (counts[row.mood] ?? 0) + 1;

  const countChips = EMOTE_MOODS.map(
    (m) => `<span data-mood-chip="${m}">${escapeHtml(m)} <b>${counts[m] ?? 0}</b></span>`,
  ).join("");

  const cards = rows
    .map((e) => {
      const changed = Boolean(overrides[e.name]);
      const opts = EMOTE_MOODS.map(
        (m) =>
          `<option value="${m}" ${e.mood === m ? "selected" : ""}>${m}${
            m === e.defaultMood ? " (default)" : ""
          }</option>`,
      ).join("");
      return `<label class="emote-card${changed ? " changed" : ""}" data-name="${escapeHtml(
        e.name.toLowerCase(),
      )}" data-mood="${e.mood}">
        <img src="${escapeHtml(e.img)}" alt="${escapeHtml(e.name)}" loading="lazy" width="48" height="48" onerror="this.style.opacity=.25">
        <span class="ename">${escapeHtml(e.name)}</span>
        <span class="edef">default: ${escapeHtml(e.defaultMood)}</span>
        <select name="mood_${escapeHtml(e.name)}">${opts}</select>
      </label>`;
    })
    .join("");

  return `<div class="card emote-shell">
    <div class="emote-shell-head">
      <div class="card-head">
        <h2>Kick emotes · mood buckets</h2>
        <button type="submit" form="emote-mood-form">Save moods</button>
      </div>
      <p class="muted">Moods follow Plutchik’s basics (happy, sad, angry, fear, surprise, disgust, trust, anticipation) plus Kick vibes (laugh, love, cool, confused, hype, dance). Change a listing to control which emotes get appended. Green border = custom override (<code>data/emote-moods.json</code>).</p>
      <div class="emote-counts">${countChips}</div>
      <div class="emote-toolbar">
        <input type="search" id="emote-filter" placeholder="Filter by name…" autocomplete="off">
        <select id="emote-mood-filter">
          <option value="">All moods</option>
          ${EMOTE_MOODS.map((m) => `<option value="${m}">${m}</option>`).join("")}
        </select>
        <button type="button" id="emote-reset-defaults" class="ghost">Reset all to defaults</button>
      </div>
    </div>
    <form id="emote-mood-form" method="post" action="/emotes" style="flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden">
      <div class="emote-grid-scroll">
        <div class="emote-grid">${cards}</div>
      </div>
    </form>
  </div>
  <script>
  (function () {
    var filter = document.getElementById("emote-filter");
    var moodFilter = document.getElementById("emote-mood-filter");
    var resetBtn = document.getElementById("emote-reset-defaults");
    function applyFilter() {
      var q = (filter.value || "").trim().toLowerCase();
      var mood = moodFilter.value || "";
      document.querySelectorAll(".emote-card").forEach(function (card) {
        var name = card.getAttribute("data-name") || "";
        var m = card.querySelector("select");
        var cur = m ? m.value : card.getAttribute("data-mood");
        var ok = (!q || name.indexOf(q) !== -1) && (!mood || cur === mood);
        card.style.display = ok ? "" : "none";
      });
    }
    if (filter) filter.addEventListener("input", applyFilter);
    if (moodFilter) moodFilter.addEventListener("change", applyFilter);
    document.querySelectorAll(".emote-card select").forEach(function (sel) {
      sel.addEventListener("change", function () {
        var card = sel.closest(".emote-card");
        if (!card) return;
        card.setAttribute("data-mood", sel.value);
        applyFilter();
      });
    });
    if (resetBtn) resetBtn.addEventListener("click", function () {
      document.querySelectorAll(".emote-card").forEach(function (card) {
        var def = (card.querySelector(".edef") || {}).textContent || "";
        var mood = (def.match(/default:\\s*(\\w+)/) || [])[1];
        var sel = card.querySelector("select");
        if (sel && mood) {
          sel.value = mood;
          card.setAttribute("data-mood", mood);
          card.classList.remove("changed");
        }
      });
      applyFilter();
    });
  })();
  </script>`;
}

function aiBody(): string {
  const ai = getSettings().ai;
  const lengthOpts: AiLength[] = ["short", "medium", "long"];
  const providerOpts: Array<{ id: AiProviderId; label: string }> = [
    { id: "auto", label: "Auto — fast model for chat, stronger for hard questions" },
    { id: "gemini", label: "Gemini only" },
    { id: "groq", label: "Groq only (free / fast)" },
    { id: "openai", label: "OpenAI only (paid API — not Auto)" },
    { id: "openrouter", label: "OpenRouter only" },
  ];
  const keys = providerStatus();
  const keyRows = keys
    .map(
      (k) =>
        `<tr><td>${escapeHtml(k.label)}</td><td><code>${escapeHtml(k.envName)}</code></td><td>${
          k.configured ? '<span class="ok">set</span>' : '<span class="warn">missing</span>'
        }</td></tr>`,
    )
    .join("");
  const catalogJson = JSON.stringify(
    Object.fromEntries(AI_CATALOG.map((p) => [p.id, p.models.map((m) => ({ id: m.id, label: m.label }))])),
  );
  return `
  <div class="card tall-card">
    <div class="card-head">
      <h2>AI agent</h2>
      <div class="row">
        <a class="btn ghost" href="/ai">Refresh</a>
      </div>
    </div>
    <p class="muted">Keys live in <code>.env</code>. Refresh reloads that file (no full restart needed). ChatGPT Pro is not an API — use <code>OPENAI_API_KEY</code> from platform.openai.com. Auto: Groq/Gemini for snappy chat, OpenAI/Gemini for harder questions.</p>
    <table class="facts" style="width:100%;margin:.5rem 0 1rem">
      <tr><th>Provider</th><th>.env key</th><th>Status</th></tr>
      ${keyRows}
    </table>
    <form class="stack ai-form" method="post" action="/ai" id="aiAgentForm">
      <label class="muted">Agent</label>
      <select name="provider" id="aiProvider">
        ${providerOpts.map((p) => `<option value="${p.id}" ${ai.provider === p.id ? "selected" : ""}>${escapeHtml(p.label)}</option>`).join("")}
      </select>
      <label class="muted">Model <span class="muted">(ignored in Auto except as a hint; empty = default)</span></label>
      <select name="model" id="aiModel"></select>
      <input type="hidden" name="modelCustom" id="aiModelCustom" value="${escapeHtml(ai.model)}">
      <p class="muted" id="aiProviderHint"></p>
      <label class="muted">Personality / how it sounds</label>
      <textarea name="personality" required>${escapeHtml(ai.personality)}</textarea>
      <label class="muted">Default answer length</label>
      <p class="muted" style="margin:0">Typical size, not a maximum. Comebacks can be 1–2 words. A paragraph is fine when Kick allows it — don't spam them.</p>
      <select name="length">
        ${lengthOpts.map((v) => `<option value="${v}" ${ai.length === v ? "selected" : ""}>${v}</option>`).join("")}
      </select>
      <label class="muted">Language</label>
      <input type="text" name="language" value="${escapeHtml(ai.language)}" required>
      <label class="muted">What it can answer</label>
      <textarea name="canAnswer" required>${escapeHtml(ai.canAnswer)}</textarea>
      <label class="muted">What it must not answer</label>
      <textarea name="cannotAnswer" required>${escapeHtml(ai.cannotAnswer)}</textarea>
      <div class="row"><button type="submit">Save AI settings</button></div>
    </form>
  </div>
  <script>
  (() => {
    const catalog = ${catalogJson};
    const hints = ${JSON.stringify(Object.fromEntries(AI_CATALOG.map((p) => [p.id, p.hint])))};
    const provider = document.getElementById("aiProvider");
    const model = document.getElementById("aiModel");
    const hint = document.getElementById("aiProviderHint");
    const saved = ${JSON.stringify(ai.model)};
    function fillModels() {
      const id = provider.value;
      hint.textContent = id === "auto"
        ? "Auto: original Gemini 3.5 Flash-Lite, then free Groq, then OpenRouter free. Paid OpenAI / gpt-4o are never used in Auto."
        : (hints[id] || "");
      const rows = id === "auto" ? [] : (catalog[id] || []);
      let html = '<option value="">Default for this agent</option>';
      for (const row of rows) {
        html += '<option value="' + row.id + '"' + (row.id === saved ? " selected" : "") + ">" + row.label + "</option>";
      }
      if (saved && id !== "auto" && !rows.some((r) => r.id === saved)) {
        html += '<option value="' + saved + '" selected>' + saved + " (custom)</option>";
      }
      model.innerHTML = html;
      model.disabled = id === "auto";
    }
    provider.addEventListener("change", fillModels);
    fillModels();
  })();
  </script>`;
}

function timerForm(action: string, hidden: string, minutes: number | null): string {
  return `<form class="who timer" method="post" action="${action}">
    ${hidden}
    ${timerSelect(minutes, true)}
  </form>`;
}

function timerSelect(minutes: number | null, autosubmit = false): string {
  const preset = timerPreset(minutes);
  const customVal = preset === "custom" ? String(minutes) : "10";
  const onchange = autosubmit
    ? `var c=this.form.querySelector('[name=custom]'); if(c){c.hidden=this.value!=='custom';} if(this.value!=='custom') this.form.submit();`
    : `var c=this.form.querySelector('[name=custom]'); if(c) c.hidden=this.value!=='custom';`;
  return `<select name="preset" onchange="${onchange}">
      <option value="none" ${preset === "none" ? "selected" : ""}>no timer</option>
      <option value="5" ${preset === "5" ? "selected" : ""}>5 min</option>
      <option value="15" ${preset === "15" ? "selected" : ""}>15 min</option>
      <option value="custom" ${preset === "custom" ? "selected" : ""}>custom</option>
    </select>
    <input type="number" name="custom" min="1" max="180" value="${escapeHtml(customVal)}" ${preset === "custom" ? "" : "hidden"} ${autosubmit ? 'onchange="this.form.submit()"' : ""}>`;
}

function whoForm(action: string, name: string, current: AccessLevel): string {
  return `<form class="who" method="post" action="${action}">
    <input type="hidden" name="name" value="${escapeHtml(name)}">
    ${whoSelect(current, true)}
  </form>`;
}

function whoSelect(current: AccessLevel, autosubmit = false): string {
  const opts = ACCESS_LEVELS.map(
    (level) => `<option value="${level}" ${level === current ? "selected" : ""}>${level}</option>`,
  ).join("");
  return `<select name="who"${autosubmit ? ' onchange="this.form.submit()"' : ""}>${opts}</select>`;
}

function looksBadNotice(text: string): boolean {
  return /\b(no |not |could not|couldn't|cannot|can't|failed|error|empty|too long|already |is a built-in|cannot be removed|does not exist|named "|pick |use letters)/i.test(
    text,
  );
}

function terminalBody(): string {
  return `<div class="card terminal-card">
    <div class="card-head">
      <h2>Terminal</h2>
      <div class="row" style="margin:0">
        <a class="btn ghost" href="/terminal">Refresh</a>
        <button type="button" class="btn danger" id="term-clear">Clear</button>
      </div>
    </div>
    <p class="muted">Live bot activity — orders, AI thinking, timeouts, Discord, failures. Auto-updates.</p>
    <div id="term-log" class="terminal-log" aria-live="polite"></div>
  </div>
  <script>
  (function(){
    const log = document.getElementById("term-log");
    const clearBtn = document.getElementById("term-clear");
    let lines = [];
    let lastId = null;
    let stickBottom = true;
    function esc(s){ return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
    function fmtTime(at){
      const d = new Date(at);
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    }
    function render(){
      const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
      log.innerHTML = lines.map(l =>
        '<div class="term-line ' + esc(l.level) + '"><span class="ts">' + esc(fmtTime(l.at)) +
        '</span><span class="src">[' + esc(l.source) + ']</span>' + esc(l.text) + '</div>'
      ).join("") || '<div class="term-line muted">Waiting for activity…</div>';
      if (stickBottom || nearBottom) log.scrollTop = log.scrollHeight;
    }
    log.addEventListener("scroll", () => {
      stickBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    });
    async function pull(full){
      try {
        const url = full || !lastId ? "/terminal/log" : "/terminal/log?after=" + encodeURIComponent(lastId);
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        const batch = Array.isArray(data) ? data : (data.lines || []);
        if (!batch.length) return;
        if (full) lines = batch;
        else lines = lines.concat(batch);
        if (lines.length > 400) lines = lines.slice(-400);
        lastId = lines[lines.length - 1].id;
        render();
      } catch (_) {}
    }
    clearBtn.addEventListener("click", async () => {
      try {
        await fetch("/terminal/log", { method: "DELETE" });
        lines = [];
        lastId = null;
        render();
      } catch (_) {}
    });
    pull(true);
    setInterval(() => pull(false), 1000);
  })();
  </script>`;
}

function adminBody(): string {
  const bot = config.bot.name;
  return `<div class="card admin-card">
    <div class="card-head">
      <h2>Admin chat</h2>
      <div class="row" style="margin:0">
        <a class="btn" href="/admin">Refresh</a>
        <button type="button" class="btn danger" id="admin-clear">Clear chat</button>
      </div>
    </div>
    <p class="muted">Talk to ${escapeHtml(bot)} like your Kick chat. Orders run for real (clear, remote say, skip, raid, title, etc.). Uses AI to understand Turkish/English slang. LAN-only.</p>
    <div id="admin-log" class="admin-log" aria-live="polite"></div>
    <form id="admin-form" class="admin-compose">
      <input type="text" id="admin-input" name="message" autocomplete="off" placeholder="Order your CamelBot" maxlength="400" />
      <button type="submit">Send</button>
    </form>
  </div>
  <script>
  (function(){
    const log = document.getElementById("admin-log");
    const form = document.getElementById("admin-form");
    const input = document.getElementById("admin-input");
    const clearBtn = document.getElementById("admin-clear");
    const botName = ${JSON.stringify(bot)};
    let lines = [];
    let execDots = 1;
    let execTimer = null;
    function esc(s){ return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
    function lineText(l){
      if(l.executing) return "Executing" + ".".repeat(execDots);
      return l.text;
    }
    function render(){
      log.innerHTML = lines.map(l => {
        const who = l.role === "user" ? "The Camel King" : l.role === "bot" ? botName : "System";
        const cls = l.role + (l.executing ? " executing" : "") + (l.error ? " error" : "");
        return '<div class="admin-line ' + cls + '"><strong>' + esc(who) + ':</strong> ' + esc(lineText(l)) + '</div>';
      }).join("");
      log.scrollTop = log.scrollHeight;
    }
    function setLines(next){
      lines = Array.isArray(next) ? next : [];
      render();
    }
    function startExecuting(){
      stopExecuting();
      execDots = 1;
      execTimer = setInterval(() => {
        execDots = execDots >= 3 ? 1 : execDots + 1;
        render();
      }, 450);
    }
    function stopExecuting(){
      if(execTimer){ clearInterval(execTimer); execTimer = null; }
    }
    async function refresh(){
      try {
        const res = await fetch("/admin/chat");
        if(!res.ok) return;
        const data = await res.json();
        if(Array.isArray(data)) setLines(data);
        else if(Array.isArray(data.lines)) setLines(data.lines);
      } catch (_) {}
    }
    clearBtn.addEventListener("click", async () => {
      stopExecuting();
      try {
        const res = await fetch("/admin/chat", { method: "DELETE" });
        if(!res.ok) return;
        const data = await res.json();
        setLines(Array.isArray(data.lines) ? data.lines : []);
      } catch (_) {}
      input.focus();
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const message = input.value.trim();
      if(!message) return;
      input.value = "";
      const now = Date.now();
      lines = lines.filter(l => !l.executing);
      lines.push({ role: "user", text: message, id: "local-u-" + now });
      lines.push({ role: "bot", text: "Executing.", executing: true, id: "local-exec-" + now });
      render();
      startExecuting();
      input.disabled = true;
      try {
        const res = await fetch("/admin/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message })
        });
        const raw = await res.text();
        let data;
        try { data = JSON.parse(raw); } catch {
          stopExecuting();
          lines = lines.filter(l => !l.executing);
          lines.push({ role: "system", text: "Server error (" + res.status + "). Reload the bot and try again.", error: true });
          render();
          return;
        }
        stopExecuting();
        if(Array.isArray(data.lines)) setLines(data.lines);
        else if(Array.isArray(data)) setLines(data);
        else if(data.error){
          lines = lines.filter(l => !l.executing);
          lines.push({ role: "system", text: data.error, error: true });
          render();
        }
      } catch(err) {
        stopExecuting();
        lines = lines.filter(l => !l.executing);
        lines.push({ role: "system", text: "Request failed. Is the bot running?", error: true });
        render();
      } finally {
        input.disabled = false;
        input.focus();
      }
    });
    refresh();
    input.focus();
  })();
  </script>`;
}

function webhookFormula(): string {
  const base = tunnelBaseUrl();
  const hook = `${base ?? "https://YOUR-TUNNEL.trycloudflare.com"}${config.kick.webhookPath}`;
  const status = base
    ? `<span class="ok">tunnel live</span>. Kick Developer webhook URL:<br><code>${escapeHtml(hook)}</code>`
    : `Tunnel is off. Run <code>powershell -File scripts\\start-webhook-tunnel.ps1</code>, then paste the printed URL + <code>${escapeHtml(config.kick.webhookPath)}</code> into Kick.`;
  return `<p class="muted"><strong>Webhook formula:</strong> Kick events (follow, sub, gift, title) → Cloudflare tunnel → this PC. ${status}</p>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch);
}
