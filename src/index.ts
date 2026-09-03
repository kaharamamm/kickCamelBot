import { claimInstance } from "./bot/instanceLock.js";
import { lanUrls } from "./bot/lan.js";
import { anyAiConfigured } from "./bot/aiProviders.js";
import { config } from "./config.js";
import { bootIntegrations, createServer } from "./server.js";

claimInstance();
const app = createServer();

const server = app.listen(config.port, () => {
  console.log(`[${config.bot.name}] http://localhost:${config.port}`);
  for (const url of lanUrls(config.port)) {
    console.log(`[${config.bot.name}] on this network: ${url}`);
  }
  console.log(`Authorize: http://localhost:${config.port}/login`);
  if (!config.kick.clientSecret) {
    console.warn("KICK_CLIENT_SECRET is empty. Copy it from Kick Developer settings into .env");
  }
  if (!anyAiConfigured()) {
    console.warn("No AI keys set. Add GEMINI_API_KEY, GROQ_API_KEY, OPENAI_API_KEY, and/or OPENROUTER_API_KEY. Commands still work.");
  }
  if (config.discord.enabled) {
    console.log("[discord] token set — will connect on boot");
  }
  void bootIntegrations();
});
server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[CamelBot] port ${config.port} is already in use. Another CamelBot copy is running — stop it first.`);
    process.exit(1);
  }
  throw err;
});
