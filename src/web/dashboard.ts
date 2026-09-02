import { ACCESS_LEVELS, getAccess, type AccessLevel } from "../bot/access.js";
import { extraChannelSlugs } from "../bot/channelStore.js";
import { formatAnkaraShort } from "../bot/clock.js";
import { lanUrls, tunnelBaseUrl } from "../bot/lan.js";
import { BUILTIN_COMMANDS } from "../bot/commands.js";
import { listCustomCommands } from "../bot/customCommands.js";
import { getCommandTimer } from "../bot/commandTimers.js";
import { DOTA_PROFILES, defaultShownKey, steamApiKeyConfigured } from "../bot/dota.js";
import { listModLog } from "../bot/modlog.js";
import { listPeople } from "../bot/memory.js";
import { formatRecapAgo, formatRecapDur, recapSnapshot } from "../bot/recap.js";
import { getSettings, type AiLength } from "../bot/settings.js";
import { listTimedCommands } from "../bot/timedStore.js";
import { timerPreset } from "../bot/timerPreset.js";
import { config } from "../config.js";
import { discordStatus } from "../discord/client.js";
import { discordInviteUrl } from "../discord/invite.js";
import {
  DISCORD_IDENTITIES,
  DISCORD_KING_ID,
  discordKingUserId,
} from "../discord/identities.js";
import { getDiscordRouting } from "../discord/settings.js";
import { liveChatChannels, liveChatStatus } from "../kick/liveChat.js";

export type DashTab = "status" | "commands" | "ai" | "mod" | "memory" | "recap" | "admin" | "discord";

const PAGE_SIZE = 12;

export async function dashboardPage(params: {
  tab: DashTab;
  authorized: boolean;
  botAccount?: string;
  notice?: string;
  noticeBad?: boolean;
  page?: number;
}): Promise<string> {
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
</style></head><body class="${tab === "ai" || tab === "mod" || tab === "memory" || tab === "admin" ? `tall-page${tab === "ai" ? " ai-page" : tab === "admin" ? " admin-page" : ""}` : ""}">
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
    <a class="${tab === "discord" ? "on" : ""}" href="/discord">Discord</a>
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
      <p>AI: ${config.gemini.apiKey ? '<span class="ok">online</span>' : '<span class="warn">off</span>'}</p>
      <p>Live chat: ${liveChatStatus.startsWith("listening") ? `<span class="ok">${escapeHtml(liveChatStatus)}</span>` : `<span class="warn">${escapeHtml(liveChatStatus)}</span>`}</p>
      <p>Mod /clear: <span class="warn">type /clear in Kick chat — bots can't run it server-side</span></p>
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
  const initialRoutes = JSON.stringify(routing.routes);
  const initialAlwaysReply = JSON.stringify(routing.alwaysReplyUsers);
  const guildOptionsJson = JSON.stringify(d.guildOptions);
  const channelsByGuildJson = JSON.stringify(d.channelsByGuild);

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
      <p>AI replies: ${config.gemini.apiKey ? '<span class="ok">Gemini ready</span>' : '<span class="warn">GEMINI_API_KEY missing</span>'}</p>
      <p>Routes: ${d.routes.length ? `<span class="ok">${d.routes.length} active</span>` : '<span class="warn">none</span>'}</p>
      <p>Always reply: ${d.alwaysReplyUserIds.length ? `<span class="ok">${d.alwaysReplyUserIds.length} users</span>` : '<span class="muted">none</span>'}</p>
      <p>Messages seen: ${d.messagesSeen} · Replies sent: ${d.repliesSent}</p>
      <p>Last message: ${escapeHtml(fmt(d.lastMessageAt))} · Last reply: ${escapeHtml(fmt(d.lastReplyAt))}</p>
      ${d.lastError ? `<p style="grid-column:1/-1">Last error: <span class="warn">${escapeHtml(d.lastError)}</span></p>` : ""}
      ${routeStatusRows}
    </div>
    <form class="stack" id="discordForm" method="post" action="/discord/settings">
      <input type="hidden" name="routesJson" id="routesJson">
      <input type="hidden" name="alwaysReplyJson" id="alwaysReplyJson">

      <h3>Listen / post routes</h3>
      <p class="muted">Add one row per server: bot reads in the listen channel and posts replies in the post channel (or the same channel). Saved to <code>data/discord.json</code>.</p>
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
      <p class="muted">These users get a reply even without @mentioning the bot. Nickname is optional if they are in Known people.</p>
      <div class="add-row">
        <label>Discord user ID
          <input type="text" id="alwaysIdInput" placeholder="231086890017751040">
        </label>
        <label>Nickname <span class="muted">(optional)</span>
          <input type="text" id="alwaysLabelInput" placeholder="mcvckaharamamm">
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
        <button type="submit">Save &amp; reconnect</button>
      </div>
    </form>
    <p class="muted">Bot needs <strong>View Channel</strong>, <strong>Send Messages</strong>, and <strong>Read Message History</strong> in both listen and post channels (when they differ).</p>
    <p class="muted">Use <strong>Invite bot to server</strong> to add AmqKeliBot to another Discord server, then refresh this page and pick that server from the dropdown.</p>
  </div>
  <script>
  (() => {
    const guildOptions = ${guildOptionsJson};
    const channelsByGuild = ${channelsByGuildJson};
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

    function renderRoutes() {
      if (!routes.length) {
        routeList.innerHTML = '<li class="muted">No routes yet — add one above.</li>';
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
        });
      });
    }

    function renderAlwaysReply() {
      if (!alwaysReply.length) {
        alwaysList.innerHTML = '<li class="muted">No users yet — add one above.</li>';
        return;
      }
      alwaysList.innerHTML = alwaysReply.map((u, i) => {
        const name = u.label || u.id;
        return '<li><span class="grow"><code>' + u.id + '</code> · <strong>' + name + '</strong></span>' +
          '<button type="button" class="danger" data-always="' + i + '">Remove</button></li>';
      }).join("");
      alwaysList.querySelectorAll("[data-always]").forEach((btn) => {
        btn.addEventListener("click", () => {
          alwaysReply.splice(Number(btn.getAttribute("data-always")), 1);
          renderAlwaysReply();
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
    });

    document.getElementById("alwaysAddBtn").addEventListener("click", () => {
      const id = alwaysIdInput.value.trim();
      const label = alwaysLabelInput.value.trim();
      if (!/^\\d{15,22}$/.test(id)) {
        alert("Enter a valid Discord user ID (15–22 digits).");
        return;
      }
      if (alwaysReply.some((u) => u.id === id)) {
        alert("That user is already in the list.");
        return;
      }
      alwaysReply.push({ id, label });
      alwaysIdInput.value = "";
      alwaysLabelInput.value = "";
      renderAlwaysReply();
    });

    form.addEventListener("submit", () => {
      routesJson.value = JSON.stringify(routes);
      alwaysReplyJson.value = JSON.stringify(alwaysReply);
    });

    fillGuildSelect();
    const presetGuild = routes[0]?.guildId || guildOptions[0]?.id || "";
    if (presetGuild) guildPick.value = presetGuild;
    fillChannelSelects(guildPick.value);
    renderRoutes();
    renderAlwaysReply();
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
  const rows = sliced.rows
    .map((p) => {
      const you = p.userId === 549839;
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
    <p class="muted">Short notes CamelBot keeps per chatter (Kick nick, bio, and a compact summary of chats with the bot). Notes appear after 5 real chat lines, so one-off bots stay out.</p>
    <div class="list-scroll">
      <ul class="list">${rows || "<li class='muted'>Nobody remembered yet. Notes appear after CamelBot talks with someone.</li>"}</ul>
    </div>
    ${pager("/memory", sliced.page, sliced.pages, sliced.total)}
  </div>`;
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

function aiBody(): string {
  const ai = getSettings().ai;
  const lengthOpts: AiLength[] = ["short", "medium", "long"];
  return `
  <div class="card tall-card">
    <h2>How CamelBot talks</h2>
    <p class="muted">These rules apply to @${config.bot.name}, questions, and home-channel chat replies.</p>
    <form class="stack ai-form" method="post" action="/ai">
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
  </div>`;
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
