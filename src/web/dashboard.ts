import { ACCESS_LEVELS, getAccess, type AccessLevel } from "../bot/access.js";
import { extraChannelSlugs } from "../bot/channelStore.js";
import { formatAnkaraShort } from "../bot/clock.js";
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
import { liveChatChannels, liveChatStatus } from "../kick/liveChat.js";

export type DashTab = "status" | "commands" | "ai" | "mod" | "memory" | "recap";

const PAGE_SIZE = 12;

export function dashboardPage(params: {
  tab: DashTab;
  authorized: boolean;
  botAccount?: string;
  notice?: string;
  noticeBad?: boolean;
  page?: number;
}): string {
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
</style></head><body class="${tab === "ai" || tab === "mod" || tab === "memory" ? `tall-page${tab === "ai" ? " ai-page" : ""}` : ""}">
<header>
  <div class="bar"><h1>${config.bot.name}</h1></div>
  <nav>
    <a class="${tab === "status" ? "on" : ""}" href="/">Status</a>
    <a class="${tab === "commands" ? "on" : ""}" href="/commands">Commands</a>
    <a class="${tab === "mod" ? "on" : ""}" href="/mod">Mod log</a>
    <a class="${tab === "memory" ? "on" : ""}" href="/memory">Memory</a>
    <a class="${tab === "recap" ? "on" : ""}" href="/recap">Recap</a>
    <a class="${tab === "ai" ? "on" : ""}" href="/ai">AI</a>
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
    <h2>Status</h2>
    <div class="grid">
      <p>Login: ${authorized ? '<span class="ok">authorized</span>' : '<span class="warn">not authorized</span>'}</p>
      <p>Posts as: ${botAccount ? `<span class="ok">${escapeHtml(botAccount)}</span>` : '<span class="warn">streamer account</span>'}</p>
      <p>AI: ${config.gemini.apiKey ? '<span class="ok">online</span>' : '<span class="warn">off</span>'}</p>
      <p>Live chat: ${liveChatStatus.startsWith("listening") ? `<span class="ok">${escapeHtml(liveChatStatus)}</span>` : `<span class="warn">${escapeHtml(liveChatStatus)}</span>`}</p>
    </div>
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
    <p class="muted">Live only: joins conversation, idle lines (5–10 min quiet, stops if the last 5 messages are CamelBot), quiz, timed messages. Offline: home channel still answers if you @CamelBot, say bot/mods, or keep talking to it. Extra channels stay silent while offline except Dota commands (<code>!mmr</code> <code>!wl</code> <code>!lastgame</code> <code>!medal</code> <code>!dota</code>) which always work.</p>
  </div>
  </div>
  </div>`;
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

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch);
}
