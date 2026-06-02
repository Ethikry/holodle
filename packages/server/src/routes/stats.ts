import type { FastifyInstance } from "fastify";
import type { UserStats } from "@holodle/shared";
import { requireUser } from "../auth/requireUser.js";
import { loadStats, getUserGuessDistribution } from "../db/client.js";

export async function statsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/stats", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { streak, best, played, winRate } = loadStats(user.id);
    const guessDistribution = getUserGuessDistribution(user.id);
    const stats: UserStats = { streak, best, played, winRate, guessDistribution };
    return stats;
  });
}
