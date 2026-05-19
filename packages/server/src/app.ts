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
import { interactionsRoutes } from "./routes/interactions.js";

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
  await app.register(interactionsRoutes);

  if (serveClient) {
    const clientDist = resolve(__dirname, "..", env.CLIENT_DIST);
    if (existsSync(clientDist)) {
      await app.register(fastifyStatic, {
        root: clientDist,
        prefix: "/",
        wildcard: false,
      });
      // Known API route names without the /api prefix. If we ever see one of
      // these arrive un-prefixed, the most likely cause is a Discord URL
      // Mapping that's stripping /api (i.e. the dev portal has a "/api → ..."
      // row instead of the recommended single "/" row). Logging this loudly
      // makes the misconfiguration self-diagnosing from server logs.
      const STRIPPED_API_PATHS = new Set([
        "/health",
        "/token",
        "/talents",
        "/daily",
        "/guess",
        "/stats",
      ]);
      app.setNotFoundHandler((req, reply) => {
        if (req.url.startsWith("/api") || req.url.startsWith("/socket.io")) {
          reply.code(404).send({ error: "Not found" });
          return;
        }
        const pathOnly = req.url.split("?")[0] ?? "";
        if (STRIPPED_API_PATHS.has(pathOnly)) {
          req.log.warn(
            `Received ${req.method} ${req.url} — looks like Discord's URL Mapping is stripping the /api prefix. ` +
              `Fix: in the dev portal Activities → URL Mappings, keep ONLY "/" → <tunnel>; remove any "/api" row.`,
          );
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
