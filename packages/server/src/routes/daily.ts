import type { FastifyInstance } from "fastify";
import type { DailyState } from "@holodle/shared";
import { MAX_GUESSES } from "@holodle/shared";
import { requireUser } from "../auth/requireUser.js";
import { loadUserDay } from "../db/client.js";
import { dayIndexFor, pickDaily, puzzleIdFor, safeTz } from "../game/dailyPicker.js";
import { getRegistry } from "../game/talents.js";

export async function dailyRoutes(app: FastifyInstance): Promise<void> {
  // Accepts ?tz=America/Chicago as a query string so the user's calendar can
  // drive which puzzle they see. Falls back to UTC when missing or invalid.
  app.get("/api/daily", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;

    const tz = safeTz(((req.query as Record<string, string | undefined>) ?? {}).tz);
    const reg = getRegistry();
    const now = Date.now();
    const answer = pickDaily(reg.activePool, now, tz);
    if (!answer) {
      reply.code(503);
      return { error: "No active talents available" };
    }

    const dayIndex = dayIndexFor(now, tz);
    const row = loadUserDay(user.id, dayIndex);
    const state: DailyState = {
      puzzleId: puzzleIdFor(now, tz),
      guessesUsed: row.guesses.length,
      history: row.guesses,
      status: row.status,
      maxGuesses: MAX_GUESSES,
    };
    return state;
  });
}
