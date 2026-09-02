import { config } from "./config.js";
import { bootIntegrations, createServer } from "./server.js";

const app = createServer();

app.listen(config.port, () => {
  console.log(`[${config.bot.name}] http://localhost:${config.port}`);
  console.log(`Authorize: http://localhost:${config.port}/login`);
  if (!config.kick.clientSecret) {
    console.warn("KICK_CLIENT_SECRET is empty. Copy it from Kick Developer settings into .env");
  }
  if (!config.gemini.apiKey) {
    console.warn("GEMINI_API_KEY is empty. Commands work; @CamelBot AI replies are off until you add a Google AI Studio key.");
  }
  void bootIntegrations();
});
