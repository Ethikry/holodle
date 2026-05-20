import { buildApp } from "./app.js";
import { env, hasPublicKey } from "./env.js";
import { attachSocketServer } from "./ws/socket.js";

async function main(): Promise<void> {
  const app = await buildApp();
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  attachSocketServer(app);
  app.log.info(`Holodle server listening on :${env.PORT}`);
  if (!hasPublicKey) {
    app.log.warn(
      "DISCORD_PUBLIC_KEY not set — /api/interactions will reject every request. " +
        "Add it from the dev portal (General Information → Public Key) and restart.",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
