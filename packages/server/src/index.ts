import { buildApp } from "./app.js";
import { armDailyRecap } from "./bot/scheduler.js";
import { env, hasBotToken } from "./env.js";
import { attachSocketServer } from "./ws/socket.js";

async function main(): Promise<void> {
  const app = await buildApp();
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  attachSocketServer(app);
  app.log.info(`Holodle server listening on :${env.PORT}`);
  if (hasBotToken) {
    armDailyRecap();
  } else {
    app.log.warn(
      "DISCORD_BOT_TOKEN not set — exit embeds and EOD recap are disabled. Set it in .env and restart to enable.",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
