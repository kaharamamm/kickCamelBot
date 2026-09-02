import { getMyChannel, getValidTokens } from "../src/kick/api.ts";

const ch = await getMyChannel();
console.log("slug", ch.slug, "broadcaster", ch.broadcaster_user_id);

const tokens = await getValidTokens();
const res = await fetch(`${process.env.KICK_API ?? "https://api.kick.com/public/v1"}/channels`, {
  headers: { Authorization: `Bearer ${tokens.accessToken}` },
});
console.log("official channels", res.status);
const json = await res.json();
console.log(JSON.stringify(json, null, 2).slice(0, 2000));
