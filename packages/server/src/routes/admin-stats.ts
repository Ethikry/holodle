import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AdminBestGuess, AdminStats } from "@holodle/shared";
import { env } from "../env.js";
import { attributeUsefulness, exploreBestGuess } from "../game/bestGuess.js";
import type { GuessStep } from "../game/bestGuess.js";
import { empiricalAttributeValue } from "../game/empiricalValue.js";
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
    // feedback gives on a typical guess. Full roster — `active` gates nothing.
    const registry = getRegistry();
    const usefulness = attributeUsefulness(registry.all);
    // Play-derived: how much each column actually told players, measured by
    // replaying every settled game's guesses against the candidate set.
    const valueInPractice = empiricalAttributeValue(games, registry);

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
      attributeValueInPractice: valueInPractice,
      nextGuessByFeedback,
      reach,
    };

    return stats;
  });

  // Best Guess Explorer: given a sequence of (guess, feedback) steps —
  // ?steps=akai-haato:EXXXEX,hoshimachi-suisei:EXEXXX — chain-filter the
  // active pool to the consistent answers and rank the optimal next
  // guesses. Empty/absent steps = start of game (ranks best openers).
  app.get("/api/admin/best-guess", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;

    const q = req.query as { steps?: string };
    const raw = (q.steps ?? "").trim();
    const parts = raw === "" ? [] : raw.split(",");
    if (parts.length > 10) {
      return reply.code(400).send({ error: "Too many steps (max 10)" });
    }
    const steps: GuessStep[] = [];
    for (const part of parts) {
      const [guessId, patternRaw, ...extra] = part.split(":");
      const pattern = (patternRaw ?? "").toUpperCase();
      if (!guessId || extra.length > 0 || !/^[EPX]{6}$/.test(pattern)) {
        return reply.code(400).send({
          error: `Malformed step "${part}" — expected <talent-id>:<EPX pattern of length 6>`,
        });
      }
      if (!getRegistry().byId.has(guessId)) {
        return reply.code(400).send({ error: `Unknown talent id: ${guessId}` });
      }
      steps.push({ guessId, pattern });
    }

    const result: AdminBestGuess = exploreBestGuess(steps, getRegistry());
    return result;
  });
}
