import { getValidTokens } from "../src/kick/api.ts";
import { config } from "../src/config.ts";

const tokens = await getValidTokens();
const headers = { Authorization: `Bearer ${tokens.accessToken}` };

const subs = await fetch(`${config.kick.apiBase}/events/subscriptions`, { headers });
const subJson = await subs.json();
console.log("subscriptions_status", subs.status);
console.log(JSON.stringify(subJson, null, 2));

const me = await fetch(`${config.kick.apiBase}/users`, { headers });
const meJson = await me.json();
console.log("user", JSON.stringify(meJson?.data?.[0]?.name), meJson?.data?.[0]?.user_id);
