import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// IMPORTANT: env.ts reads process.env at import time. Set env BEFORE importing
// any server modules.
const tmpDir = mkdtempSync(join(tmpdir(), "holodle-test-"));
process.env.DB_PATH = join(tmpDir, "test.db");
process.env.NODE_ENV = "test";
// No DISCORD_CLIENT_SECRET → requireUser's dev escape hatch is active.

const fixturesDir = resolve(fileURLToPath(import.meta.url), "..", "fixtures");
const TALENTS = join(fixturesDir, "talents.json");

const { buildApp } = await import("../src/app.js");
const { dayIndexFor, pickAndLogDaily } = await import("../src/game/dailyPicker.js");
const {
  getPickLogCounts,
  getPickLogEntry,
  getPickLogRecent,
  getPickLogRecentOrdered,
  insertPickLog,
} = await import("../src/db/client.js");
const { getRegistry } = await import("../src/game/talents.js");

const app = await buildApp({ talentsJsonPath: TALENTS, serveClient: false, log: false });

// Mirrors the deps wiring in routes/{daily,guess}.ts. Calling this from
// the test will either return the already-logged answer for today OR
// pick one + write it, after which the route will see the same row.
const pickLogDeps = {
  getEntry: getPickLogEntry,
  getRecent: getPickLogRecent,
  getRecentOrdered: getPickLogRecentOrdered,
  getCounts: getPickLogCounts,
  insert: insertPickLog,
};

// Determine today's answer the same way the route will: ask the
// weighted-random picker for the current dayIndex (in UTC, matching the
// route default when no tz header is present). First call seeds the
// log; subsequent calls — including the one inside the route — read it.
function pickDaily(activePool: ReturnType<typeof getRegistry>["activePool"]) {
  const dayIndex = dayIndexFor(Date.now(), "UTC");
  return pickAndLogDaily(activePool, dayIndex, pickLogDeps);
}

afterAll(async () => {
  await app.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

const AUTH = { Authorization: "Bearer dev:user1" };

function guess(talentId: string) {
  return app.inject({
    method: "POST",
    url: "/api/guess",
    headers: AUTH,
    payload: { talentId },
  });
}

describe("POST /api/guess", () => {
  it("rejects unknown talentId with 404", async () => {
    const r = await guess("does-not-exist");
    expect(r.statusCode).toBe(404);
  });

  it("rejects guess after winning with 409", async () => {
    // Win on the first try: use the actual daily answer for today.
    const answer = pickDaily(getRegistry().activePool);
    expect(answer).not.toBeNull();
    const r1 = await app.inject({
      method: "POST",
      url: "/api/guess",
      headers: { Authorization: "Bearer dev:winner" },
      payload: { talentId: answer!.id },
    });
    expect(r1.statusCode).toBe(200);
    expect(r1.json().status).toBe("won");

    const r2 = await app.inject({
      method: "POST",
      url: "/api/guess",
      headers: { Authorization: "Bearer dev:winner" },
      payload: { talentId: answer!.id },
    });
    expect(r2.statusCode).toBe(409);
  });

  it("rejects a 7th guess with 409 (loss after 6)", async () => {
    const answer = pickDaily(getRegistry().activePool)!;
    const allIds = getRegistry().all.map((t) => t.id);
    // Pick 6 ids that are NOT the answer. With only 3 fixture talents, we
    // submit the same wrong id repeatedly — but the server doesn't dedupe by
    // talentId, so each call counts as a guess.
    const wrong = allIds.find((id) => id !== answer.id)!;

    for (let i = 0; i < 6; i++) {
      const r = await app.inject({
        method: "POST",
        url: "/api/guess",
        headers: { Authorization: "Bearer dev:loser" },
        payload: { talentId: wrong },
      });
      expect(r.statusCode).toBe(200);
      if (i === 5) {
        // The losing (6th) guess settles the day and must reveal the answer so
        // the failure screen can show the talent's avatar + name (bug 9).
        expect(r.json().status).toBe("lost");
        expect(r.json().answer?.id).toBe(answer.id);
      }
    }
    // 7th guess after a lost status: 409
    const r7 = await app.inject({
      method: "POST",
      url: "/api/guess",
      headers: { Authorization: "Bearer dev:loser" },
      payload: { talentId: wrong },
    });
    expect(r7.statusCode).toBe(409);
  });

  it("rejects unauthenticated requests with 401", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/guess",
      payload: { talentId: "alpha" },
    });
    expect(r.statusCode).toBe(401);
  });

  it("updates /api/stats after a win (streak=1, played=1, winRate=1)", async () => {
    const answer = pickDaily(getRegistry().activePool)!;
    const auth = { Authorization: "Bearer dev:statscheck" };

    // Pre-win: stats are zero.
    const before = await app.inject({ method: "GET", url: "/api/stats", headers: auth });
    expect(before.json()).toEqual({ streak: 0, best: 0, played: 0, winRate: 0 });

    const r = await app.inject({
      method: "POST",
      url: "/api/guess",
      headers: auth,
      payload: { talentId: answer.id },
    });
    expect(r.json().status).toBe("won");
    expect(r.json().answer?.id).toBe(answer.id);

    const after = await app.inject({ method: "GET", url: "/api/stats", headers: auth });
    expect(after.json()).toEqual({ streak: 1, best: 1, played: 1, winRate: 1 });
  });

  it("/api/daily returns the in-progress history for a user", async () => {
    const auth = { Authorization: "Bearer dev:resumer" };
    const wrong = getRegistry()
      .all.map((t) => t.id)
      .find((id) => id !== pickDaily(getRegistry().activePool)!.id)!;

    await app.inject({ method: "POST", url: "/api/guess", headers: auth, payload: { talentId: wrong } });
    const daily = await app.inject({ method: "GET", url: "/api/daily", headers: auth });
    expect(daily.statusCode).toBe(200);
    const body = daily.json();
    expect(body.guessesUsed).toBe(1);
    expect(body.history).toHaveLength(1);
    expect(body.status).toBe("playing");
    expect(body.maxGuesses).toBe(6);
    expect(typeof body.puzzleId).toBe("string");
  });
});
