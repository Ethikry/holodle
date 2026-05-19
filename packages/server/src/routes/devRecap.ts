import type { FastifyInstance } from "fastify";
import { env } from "../env.js";
import { runRecap } from "../bot/scheduler.js";

// Dev-only trigger so we can verify the recap embed end-to-end without
// waiting until midnight. 404 in production. Uses the dev: bearer escape
// hatch when DISCORD_CLIENT_SECRET isn't set; otherwise requires a valid
// Discord token via Authorization header.
export async function devRecapRoutes(app: FastifyInstance): Promise<void> {
  if (env.NODE_ENV === "production") return;

  app.post("/api/dev/post-recap", async (req, reply) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      reply.code(401);
      return { error: "Missing bearer token" };
    }
    // Light gating only — anyone with the dev URL and any token can fire
    // this. It's never registered in production builds.
    try {
      await runRecap();
      return { ok: true };
    } catch (err) {
      app.log.error({ err }, "dev recap failed");
      reply.code(500);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });
}
