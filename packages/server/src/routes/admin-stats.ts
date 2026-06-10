import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AdminBestGuess, AdminStats } from "@holodle/shared";
import { env } from "../env.js";
import { attributeUsefulness, exploreBestGuess } from "../game/bestGuess.js";
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

// Shared gate for all admin endpoints: 404 when the feature is disabled
// (no ADMIN_TOKEN configured), 401 on a missing/wrong token. Returns false
// after sending the error so handlers can early-return.
function requireAdmin(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!env.ADMIN_TOKEN) {
    void reply.code(404).send({ error: "Admin stats not available" });
    return false;
  }
  const token = req.headers["x-admin-token"];
  if (!token || token !== env.ADMIN_TOKEN) {
    void reply.code(401).send({ error: "Unauthorized" });
    return false;
  }
  return true;
}

export async function adminStatsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/admin/stats", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;

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
    // Roster-derived (not play-derived): how much information each column's
    // feedback gives on a typical guess.
    const registry = getRegistry();
    const usefulness = attributeUsefulness(registry.all, registry.activePool);

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
      attributeUsefulness: usefulness,
      nextGuessByFeedback,
      reach,
    };

    return stats;
  });

  // Best Guess Explorer: given a guessed talent + the feedback it returned,
  // compute the consistent answer set and the optimal next guesses.
  // ?guess=start (or omitted) means "no guesses yet" — ranks best openers.
  app.get("/api/admin/best-guess", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;

    const q = req.query as { guess?: string; pattern?: string };
    const guessParam = q.guess && q.guess !== "start" ? q.guess : null;
    const pattern = (q.pattern ?? "").toUpperCase();

    if (guessParam !== null) {
      if (!/^[EPX]{6}$/.test(pattern)) {
        return reply
          .code(400)
          .send({ error: "pattern must be six characters of E/P/X" });
      }
      if (!getRegistry().byId.has(guessParam)) {
        return reply.code(400).send({ error: `Unknown talent id: ${guessParam}` });
      }
    }

    const result: AdminBestGuess = exploreBestGuess(guessParam, pattern, getRegistry());
    return result;
  });
}
