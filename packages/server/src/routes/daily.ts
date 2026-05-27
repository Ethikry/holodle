import type { FastifyInstance } from "fastify";
import type { DailyState } from "@holodle/shared";
import { MAX_GUESSES } from "@holodle/shared";
import { requireUser } from "../auth/requireUser.js";
import {
  getPickLogCounts,
  getPickLogEntry,
  getPickLogRecent,
  getPickLogRecentOrdered,
  insertPickLog,
  loadUserDay,
} from "../db/client.js";
import {
  dayIndexFor,
  pickAndLogDaily,
  pickByIndex,
  puzzleIdFor,
  safeTz,
} from "../game/dailyPicker.js";
import { getRegistry } from "../game/talents.js";

// DB-backed deps for the weighted picker. One singleton so we're not
// closing over a fresh object on every request.
const pickLogDeps = {
  getEntry: getPickLogEntry,
  getRecent: getPickLogRecent,
  getRecentOrdered: getPickLogRecentOrdered,
  getCounts: getPickLogCounts,
  insert: insertPickLog,
};

export async function dailyRoutes(app: FastifyInstance): Promise<void> {
  // Accepts ?tz=America/Chicago as a query string so the user's calendar can
  // drive which puzzle they see. Falls back to UTC when missing or invalid.
  app.get("/api/daily", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;

    const tz = safeTz(((req.query as Record<string, string | undefined>) ?? {}).tz);
    const reg = getRegistry();
    const now = Date.now();
    const dayIndex = dayIndexFor(now, tz);
    const row = loadUserDay(user.id, dayIndex);
    // `endlessOffset` is 0 outside the test guild; the /endless command in
    // the test guild bumps it to rotate the answer without bumping calendars.
    // Normal play uses the weighted-random log-backed picker (so picks
    // bias toward less-frequently-seen talents); /endless stays on the
    // pure shuffle picker so it doesn't pollute the daily_pick_log with
    // day-indexes the natural sequence will hit later.
    const answer = row.endlessOffset > 0
      ? pickByIndex(reg.activePool, dayIndex + row.endlessOffset)
      : pickAndLogDaily(reg.activePool, dayIndex, pickLogDeps);
    if (!answer) {
      reply.code(503);
      return { error: "No active talents available" };
    }
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
