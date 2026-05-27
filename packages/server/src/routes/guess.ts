import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { GuessResponse } from "@holodle/shared";
import { MAX_GUESSES, boardRowFromDiff } from "@holodle/shared";
import { requireUser } from "../auth/requireUser.js";
import {
  getPickLogCounts,
  getPickLogEntry,
  getPickLogRecent,
  getPickLogRecentOrdered,
  insertPickLog,
  loadUserDay,
  saveUserDay,
  settleDay,
} from "../db/client.js";
import { compareGuess } from "../game/compare.js";
import {
  dayIndexFor,
  pickAndLogDaily,
  pickByIndex,
  puzzleIdFor,
  safeTz,
} from "../game/dailyPicker.js";

// DB-backed deps for the weighted picker. Identical shape to the
// version in routes/daily.ts; both routes target the same log so the
// daily fetch and the first guess see the same answer.
const pickLogDeps = {
  getEntry: getPickLogEntry,
  getRecent: getPickLogRecent,
  getRecentOrdered: getPickLogRecentOrdered,
  getCounts: getPickLogCounts,
  insert: insertPickLog,
};
import { updateProgress } from "../game/instance.js";
import { getRegistry } from "../game/talents.js";
import { recordParticipantProgress } from "../game/channelState.js";
import { broadcastProgress } from "../ws/socket.js";

const BodySchema = z.object({
  talentId: z.string().min(1),
  // Optional — needed to broadcast progress to the right Socket.IO room.
  instanceId: z.string().optional(),
  // Optional — the channel the activity was launched from. Persisted so the
  // exit embed (step G) and the EOD recap (step H) know where to post.
  channelId: z.string().optional(),
  // Optional IANA timezone. Selects which user-local calendar drives the
  // daily puzzle. Falls back to UTC when missing or invalid.
  tz: z.string().optional(),
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
    const { talentId, instanceId, channelId } = parsed.data;
    const tz = safeTz(parsed.data.tz);

    const reg = getRegistry();
    const guess = reg.byId.get(talentId);
    if (!guess) {
      reply.code(404);
      return { error: "Unknown talentId" };
    }

    const now = Date.now();
    const dayIndex = dayIndexFor(now, tz);
    const row = loadUserDay(user.id, dayIndex);
    // endlessOffset is 0 in normal play; /endless in the test guild bumps
    // it so each invocation rotates this user to a fresh talent without
    // waiting on the calendar. Normal play uses the weighted-random
    // log-backed picker; /endless stays on the pure shuffle picker so it
    // doesn't pollute the log with day-indexes the natural sequence will
    // hit later (see comment in routes/daily.ts).
    const answer = row.endlessOffset > 0
      ? pickByIndex(reg.activePool, dayIndex + row.endlessOffset)
      : pickAndLogDaily(reg.activePool, dayIndex, pickLogDeps);
    if (!answer) {
      reply.code(503);
      return { error: "No active talents available" };
    }

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

    // Stash channel + tz so the disconnect handler and recap scheduler can
    // find this row later. Stamp settled_at on terminal status so the recap
    // window query has a value to match against.
    if (channelId) row.channelId = channelId;
    row.tz = tz;
    if (row.status !== "playing" && row.settledAt === null) {
      row.settledAt = Math.floor(now / 1000);
    }

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

    const board = row.guesses.map(boardRowFromDiff);
    if (instanceId) {
      updateProgress(instanceId, user.id, row.guesses.length, row.status, board);
      broadcastProgress(instanceId, user.id, row.guesses.length, row.status, board);
    }

    // Persist this guess against the channel's now-playing row and — if a
    // fresh interaction token still exists — re-render + patch the embed
    // image so other viewers see the new line immediately. Channel state
    // is keyed by the USER's tz puzzle id so cross-tz players in the same
    // channel each see an embed for the puzzle they're actually playing;
    // recordParticipantProgress will borrow a fresh token from another
    // puzzle row and POST a brand-new embed when no row exists yet for
    // this puzzle (e.g. user crossed local midnight without re-/launching).
    // Fire-and-forget; a Discord outage must never fail this response.
    if (row.channelId) {
      const channelPuzzleId = puzzleIdFor(now, tz);
      void recordParticipantProgress(
        user.id,
        row.channelId,
        channelPuzzleId,
        user.displayName,
        row.guesses,
        row.status,
        Math.floor(now / 1000),
        tz,
      ).catch((err) => {
        req.log.error({ err }, "recordParticipantProgress threw");
      });
    }

    return response;
  });
}
