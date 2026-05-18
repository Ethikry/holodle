import { buildApp } from "./app.js";
import { attachSocketServer } from "./ws/socket.js";
import { env } from "./env.js";

async function main(): Promise<void> {
  const app = await buildApp();
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  attachSocketServer(app);
  app.log.info(`Holodle server listening on :${env.PORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
