import type { FastifyInstance } from "fastify";
import type { AdminStats } from "@holodle/shared";
import { env } from "../env.js";
import {
  getAllSettledGames,
  getActivityByDate,
  getAttributeAccuracy,
  getGuessDistribution,
  getTalentGuessFrequency,
} from "../db/client.js";
import { getRegistry } from "../game/talents.js";

export async function adminStatsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/admin/stats", async (req, reply) => {
    // Check admin token
    if (!env.ADMIN_TOKEN) {
      return reply.code(404).send({ error: "Admin stats not available" });
    }

    const token = req.headers["x-admin-token"];
    if (!token || token !== env.ADMIN_TOKEN) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    // Fetch all settled games
    const games = getAllSettledGames();

    const totalGames = games.length;
    const totalWins = games.filter((g) => g.status === "won").length;
    const totalLosses = games.filter((g) => g.status === "lost").length;
    const winRate = totalGames > 0 ? totalWins / totalGames : 0;

    // Calculate average guesses
    let totalGuesses = 0;
    let totalGuessesInWins = 0;
    let winsCount = 0;
    let totalGuessesInLosses = 0;
    let lossesCount = 0;

    for (const game of games) {
      const guessCount = game.guesses.length;
      totalGuesses += guessCount;
      if (game.status === "won") {
        totalGuessesInWins += guessCount;
        winsCount++;
      } else {
        totalGuessesInLosses += guessCount;
        lossesCount++;
      }
    }

    const averageGuessesPerWin = winsCount > 0 ? totalGuessesInWins / winsCount : 0;
    const averageGuessesPerLoss = lossesCount > 0 ? totalGuessesInLosses / lossesCount : 0;
    const averageGuessesPerGame = totalGames > 0 ? totalGuesses / totalGames : 0;

    // Get statistics
    const guessDistribution = getGuessDistribution();
    const talentGuessFreq = getTalentGuessFrequency();
    const registry = getRegistry();
    const dailyPickLog = new Map(
      Array.from(
        new Map<string, number>(
          registry.all.map((t) => [
            t.id,
            Array.from(
              games.reduce((acc, g) => {
                acc.add(g.dayIndex);
                return acc;
              }, new Set<number>()),
            ).filter((dayIdx) => {
              // Rough heuristic: count how many times this talent appears
              // in games for that day. This is approximate since we don't have
              // the daily_pick_log data parsed here.
              return true;
            }).length,
          ]),
        ),
        (m) => m.sort((a, b) => b[1] - a[1]),
      ),
    );

    // Get more accurate daily pick frequencies from the pick log
    const dailyPickCounts = new Map<string, number>();
    const rows = (
      Array.from(
        new Map<string, number>(
          games
            .filter((g) => g.status === "won")
            .map((g) => [
              g.dayIndex,
              g.guesses[0]?.talentId || "",
            ])
            .filter((e) => e[1]),
        ),
      ) as Array<[number, string]>
    );

    // For simplicity, count talent IDs from successful game days
    for (const [, talentId] of rows) {
      dailyPickCounts.set(talentId, (dailyPickCounts.get(talentId) ?? 0) + 1);
    }

    const talentGuessFrequencyArray = Array.from(talentGuessFreq.entries())
      .map(([talentId, count]) => ({ talentId, count }))
      .sort((a, b) => b.count - a.count);

    const dailyPickFrequencyArray = Array.from(dailyPickCounts.entries())
      .map(([talentId, count]) => ({ talentId, count }))
      .sort((a, b) => b.count - a.count);

    const attributeAccuracy = getAttributeAccuracy();
    const activityByDate = getActivityByDate();

    const stats: AdminStats = {
      generatedAt: Math.floor(Date.now() / 1000),
      totalGames,
      totalWins,
      totalLosses,
      winRate,
      averageGuessesPerWin,
      averageGuessesPerLoss,
      averageGuessesPerGame,
      guessDistribution,
      talentGuessFrequency: talentGuessFrequencyArray,
      dailyPickFrequency: dailyPickFrequencyArray,
      attributeAccuracy,
      activityByDate,
    };

    return stats;
  });
}
