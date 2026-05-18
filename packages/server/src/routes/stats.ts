import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth/requireUser.js";
import { loadStats } from "../db/client.js";

export async function statsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/stats", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { streak, best, played, winRate } = loadStats(user.id);
    return { streak, best, played, winRate };
  });
}
