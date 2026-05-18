import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { GuessResponse } from "@holodle/shared";
import { MAX_GUESSES } from "@holodle/shared";
import { requireUser } from "../auth/requireUser.js";
import { loadUserDay, saveUserDay, settleDay } from "../db/client.js";
import { compareGuess } from "../game/compare.js";
import { dayIndexFor, pickDaily } from "../game/dailyPicker.js";
import { updateProgress } from "../game/instance.js";
import { getRegistry } from "../game/talents.js";
import { broadcastProgress } from "../ws/socket.js";

const BodySchema = z.object({
  talentId: z.string().min(1),
  // Optional — only needed to broadcast progress to the right Socket.IO room.
  // If absent, the guess still persists but no room update is emitted.
  instanceId: z.string().optional(),
});

export async function guessRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/guess", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;

    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: "Invalid body", details: parsed.error.flatten() };
    }
    const { talentId, instanceId } = parsed.data;

    const reg = getRegistry();
    const guess = reg.byId.get(talentId);
    if (!guess) {
      reply.code(404);
      return { error: "Unknown talentId" };
    }

    const answer = pickDaily(reg.activePool);
    if (!answer) {
      reply.code(503);
      return { error: "No active talents available" };
    }

    const dayIndex = dayIndexFor();
    const row = loadUserDay(user.id, dayIndex);

    if (row.status !== "playing") {
      reply.code(409);
      return { error: "Day already settled" };
    }
    if (row.guesses.length >= MAX_GUESSES) {
      reply.code(409);
      return { error: "No guesses remaining" };
    }

    const diff = compareGuess(guess, answer);
    row.guesses.push(diff);

    const won = guess.id === answer.id;
    const exhausted = row.guesses.length >= MAX_GUESSES;
    if (won) row.status = "won";
    else if (exhausted) row.status = "lost";

    saveUserDay(row);
    if (row.status !== "playing") {
      settleDay(user.id, dayIndex, won);
    }

    const response: GuessResponse = {
      diff,
      status: row.status,
      guessesUsed: row.guesses.length,
    };
    if (row.status !== "playing") {
      response.answer = {
        id: answer.id,
        name: answer.name,
        avatarUrl: answer.avatarUrl,
      };
    }

    if (instanceId) {
      updateProgress(instanceId, user.id, row.guesses.length, row.status);
      broadcastProgress(instanceId, user.id, row.guesses.length, row.status);
    }

    return response;
  });
}
