import type { FastifyInstance } from "fastify";
import type { DailyState } from "@holodle/shared";
import { MAX_GUESSES } from "@holodle/shared";
import { requireUser } from "../auth/requireUser.js";
import { loadUserDay } from "../db/client.js";
import { dayIndexFor, pickDaily, puzzleIdFor } from "../game/dailyPicker.js";
import { getRegistry } from "../game/talents.js";

export async function dailyRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/daily", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;

    const reg = getRegistry();
    const answer = pickDaily(reg.activePool);
    if (!answer) {
      reply.code(503);
      return { error: "No active talents available" };
    }

    const dayIndex = dayIndexFor();
    const row = loadUserDay(user.id, dayIndex);
    const state: DailyState = {
      puzzleId: puzzleIdFor(),
      guessesUsed: row.guesses.length,
      history: row.guesses,
      status: row.status,
      maxGuesses: MAX_GUESSES,
    };
    return state;
  });
}
