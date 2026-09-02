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

After that the bot can **send** chat and run title / leaderboard / rewards commands. It still cannot **read** live chat until webhooks are on.

## 4. Receive chat (webhooks)

Kick only delivers chat to a **public HTTPS** URL. Localhost is not enough.

While `npm run dev` is running, in another terminal:

```bash
# if you have cloudflared:
cloudflared tunnel --url http://localhost:3000
```

Or use ngrok: `ngrok http 3000`.

Copy the `https://....trycloudflare.com` (or ngrok) URL and:

1. Kick → Developer → CamelBot → turn **Web kancalarını etkinleştirin** ON
2. Webhook URL: `https://YOUR-TUNNEL/webhooks/kick`
3. Save
4. Open [http://localhost:3000/login](http://localhost:3000/login) once more so the bot can subscribe to `chat.message.sent`

Then type `!ping` in your Kick chat. You should see `pong`.

## Notes

- Tokens are stored in `data/tokens.json` (gitignored). Access tokens expire about every hour; the bot refreshes them automatically.
- AI only answers when someone `@CamelBot`s or replies to the bot. Commands never spend Gemini tokens.
- Song requests are an in-memory queue for now (resets when the bot restarts). Spotify/YouTube can be wired later.
- Loyalty: Kick only lets CamelBot edit rewards **this app created**. Rewards you made by hand in Kick still show up in `!rewards`.
