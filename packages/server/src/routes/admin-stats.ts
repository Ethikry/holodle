import type { FastifyInstance } from "fastify";
import type { AdminStats } from "@holodle/shared";
import { env } from "../env.js";
import {
  getAllSettledGames,
  getActivityByDate,
  getAttributeAccuracy,
  getAttributeBreakdown,
  getGuessDistribution,
  getGuessDistributionByOutcome,
  getTalentGuessFrequency,
  getSecondGuessFrequency,
  getNextGuessByFeedback,
  getFirstGuessFrequency,
  getFirstGuessEffectiveness,
  getPerAnswerTalentStats,
  getReachStats,
  getPickLogCounts,
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

    for (const game of games) {
      const guessCount = game.guesses.length;
      totalGuesses += guessCount;
      if (game.status === "won") {
        totalGuessesInWins += guessCount;
        winsCount++;
      }
    }

    const averageGuessesPerWin = winsCount > 0 ? totalGuessesInWins / winsCount : 0;
    const averageGuessesPerGame = totalGames > 0 ? totalGuesses / totalGames : 0;

    // Get statistics
    const guessDistribution = getGuessDistribution();
    const guessDistributionByOutcome = getGuessDistributionByOutcome();
    const talentGuessFreq = getTalentGuessFrequency();
    const dailyPickCounts = getPickLogCounts();

    const talentGuessFrequencyArray = Array.from(talentGuessFreq.entries())
      .map(([talentId, v]) => ({ talentId, count: v.total, nonAnswerCount: v.nonAnswer }))
      .sort((a, b) => b.count - a.count);

    const dailyPickFrequencyArray = Array.from(dailyPickCounts.entries())
      .map(([talentId, count]) => ({ talentId, count }))
      .sort((a, b) => b.count - a.count);

    const attributeAccuracy = getAttributeAccuracy();
    const activityByDate = getActivityByDate();
    const perAnswerTalent = getPerAnswerTalentStats();
    const attributeBreakdown = getAttributeBreakdown();
    const reach = getReachStats();
    const firstGuessEffectiveness = getFirstGuessEffectiveness();
    const secondGuessFrequency = getSecondGuessFrequency();
    const nextGuessByFeedback = getNextGuessByFeedback();

    const firstGuessFrequencyArray = Array.from(getFirstGuessFrequency().entries())
      .map(([talentId, count]) => ({ talentId, count }))
      .sort((a, b) => b.count - a.count);

    const stats: AdminStats = {
      generatedAt: Math.floor(Date.now() / 1000),
      totalGames,
      totalWins,
      totalLosses,
      winRate,
      averageGuessesPerWin,
      averageGuessesPerGame,
      guessDistribution,
      guessDistributionByOutcome,
      talentGuessFrequency: talentGuessFrequencyArray,
      dailyPickFrequency: dailyPickFrequencyArray,
      secondGuessFrequency,
      attributeAccuracy,
      activityByDate,
      perAnswerTalent,
      firstGuessFrequency: firstGuessFrequencyArray,
      firstGuessEffectiveness,
      attributeBreakdown,
      nextGuessByFeedback,
      reach,
    };

    return stats;
  });
}
