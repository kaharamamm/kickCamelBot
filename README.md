# CamelBot

Kick chat mod bot: commands, song requests, title changes, KICKs leaderboard, loyalty rewards, and optional AI replies.

## What it can do in chat

| Command | Who | What |
|---|---|---|
| `!commands` | everyone | List commands |
| `!roll` `!roll 20` `!roll 1 6` | everyone | Random number |
| `!coinflip` | everyone | Heads / tails |
| `!8ball <question>` | everyone | Magic 8-ball |
| `!sr <song>` | everyone | Add a song request |
| `!song` `!queue` | everyone | Now playing / queue |
| `!skip` | mods | Skip current request |
| `!title` | everyone | Show stream title |
| `!title <new title>` | mods / you | Change stream title |
| `!top` `!top week` `!top month` | everyone | KICKs gifter leaderboard |
| `!rewards` | everyone | List loyalty point rewards |
| `!rewardadd 100 Song Request` | mods | Create a loyalty reward |
| `@CamelBot ...` | everyone | AI reply (needs Gemini key) |

## 1. Finish the Kick app

Your CamelBot app already exists. Do these in Kick → Settings → Developer → CamelBot:

1. Copy **İstemci Parolası (Client Secret)** into `.env` as `KICK_CLIENT_SECRET`. Do not paste the secret in chat. If you never copied it, click **Yeniden oluştur**, then save the new value immediately.
2. Leave **Yayın anahtarını görüntüle** unchecked.
3. You can uncheck the two **reklam / ads** boxes. CamelBot does not use ads.
4. Keep channel read/write, chat write, events, KICKs, loyalty rewards, and moderation.
5. Still on that screen: **Edit** the app and create a **BOT** for this account if Kick shows that button. That is the official bot badge.
6. Leave webhooks **off** until step 4.

Redirect URL must stay exactly:

```text
http://localhost:3000/callback
```

## 2. Fill `.env`

```bash
cd ~/Desktop/Projects/CamelBot
cp .env.example .env   # already created; just edit it
```

Required:

- `KICK_CLIENT_ID` — already filled
- `KICK_CLIENT_SECRET` — paste from Kick

Optional (AI talk):

1. Open [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Create an API key
3. Put it in `GEMINI_API_KEY`

Without a Gemini key, all `!` commands still work. `@CamelBot` chat replies stay off.

## 3. Install and authorize

```bash
cd ~/Desktop/Projects/CamelBot
npm install
npm run dev
```

Open [http://localhost:3000/login](http://localhost:3000/login), log into **your streamer Kick account**, and allow CamelBot.

After that the bot can **send** chat, **read** live chat, and run title / leaderboard / rewards commands. Leave the dashboard tab closed; Kick talk does not go through localhost.

## 4. Keep it running on this PC

Live chat uses Kick's socket. **No public IP, Cloudflare, or webhook is required** for commands and @CamelBot.

This PC is already `192.168.1.37` on your LAN. Open the dashboard from any device on the same Wi‑Fi/modem:

```text
http://192.168.1.37:3000
```

In the modem, reserve that address for this PC (DHCP reservation) so it does not change. **Do not port-forward port 3000** to the internet — the dashboard has no password.

To start CamelBot when the **PC boots** (no Windows logon task):

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-autostart.ps1
```

Run that as Administrator if you want it up before anyone signs into Windows. Logs: `data/camelbot.log`.

## 5. Webhooks (follows, subs, gifts, title)

Kick will not send those events to a LAN IP. Formula:

```text
Kick Developer webhook URL
  -> Cloudflare quick tunnel (HTTPS)
    -> only /webhooks/kick on this PC
      -> CamelBot
```

The dashboard stays on `http://192.168.1.37:3000`. The tunnel hostname is public, but CamelBot answers **only** `/webhooks/kick` from it.

1. CamelBot must already be running (`npm run dev` or `npm start`).
2. In another terminal:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-webhook-tunnel.ps1
```

3. Copy `https://….trycloudflare.com/webhooks/kick` into Kick → Developer → CamelBot → webhooks ON.
4. Open http://localhost:3000/login once so subscriptions refresh.
5. Leave the tunnel window open. If it restarts, the hostname changes — paste the new URL into Kick again.

## Notes

- Tokens are stored in `data/tokens.json` (gitignored). Access tokens expire about every hour; the bot refreshes them automatically.
- AI only answers when someone `@CamelBot`s or replies to the bot. Commands never spend Gemini tokens.
- Song requests are an in-memory queue for now (resets when the bot restarts). Spotify/YouTube can be wired later.
- Loyalty: Kick only lets CamelBot edit rewards **this app created**. Rewards you made by hand in Kick still show up in `!rewards`.
