import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { corsOrigins, env } from "./env.js";
import { loadTalents } from "./game/talents.js";
import { getDb } from "./db/client.js";
import { healthRoutes } from "./routes/health.js";
import { tokenRoutes } from "./routes/token.js";
import { talentsRoutes } from "./routes/talents.js";
import { dailyRoutes } from "./routes/daily.js";
import { guessRoutes } from "./routes/guess.js";
import { statsRoutes } from "./routes/stats.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface BuildAppOptions {
  talentsJsonPath?: string;
  serveClient?: boolean;
  log?: boolean;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const repoRoot = resolve(__dirname, "../../..");
  const talentsJsonPath = options.talentsJsonPath ?? resolve(repoRoot, "talent_data.json");
  const serveClient = options.serveClient ?? true;

  const app = Fastify({
    logger:
      options.log === false
        ? false
        : { level: env.NODE_ENV === "production" ? "info" : "debug" },
  });

  await app.register(cors, { origin: corsOrigins, credentials: true });

  getDb();

  const registry = loadTalents(talentsJsonPath);
  app.log.info(`${registry.all.length} talents loaded (${registry.activePool.length} active)`);

  await app.register(healthRoutes);
  await app.register(tokenRoutes);
  await app.register(talentsRoutes);
  await app.register(dailyRoutes);
  await app.register(guessRoutes);
  await app.register(statsRoutes);

  if (serveClient) {
    const clientDist = resolve(__dirname, "..", env.CLIENT_DIST);
    if (existsSync(clientDist)) {
      await app.register(fastifyStatic, {
        root: clientDist,
        prefix: "/",
        wildcard: false,
      });
      app.setNotFoundHandler((req, reply) => {
        if (req.url.startsWith("/api") || req.url.startsWith("/socket.io")) {
          reply.code(404).send({ error: "Not found" });
          return;
        }
        reply.sendFile("index.html");
      });
      app.log.info(`Serving built client from ${clientDist}`);
    } else {
      app.log.info(`No built client at ${clientDist} (dev mode — run Vite separately).`);
    }
  }

  return app;
}
