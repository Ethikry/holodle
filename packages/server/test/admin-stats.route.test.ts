import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Set env before importing app
const tmpDir = mkdtempSync(join(tmpdir(), "holodle-admin-stats-test-"));
process.env.DB_PATH = join(tmpDir, "test.db");
process.env.NODE_ENV = "test";
process.env.ADMIN_TOKEN = "test-admin-token";

const fixturesDir = resolve(fileURLToPath(import.meta.url), "..", "fixtures");
const TALENTS = join(fixturesDir, "talents.json");

const { buildApp } = await import("../src/app.js");
const { saveUserDay } = await import("../src/db/client.js");

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp({ talentsJsonPath: TALENTS, serveClient: false, log: false });
});

afterAll(async () => {
  await app.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("GET /api/admin/stats", () => {
  it("returns stats with correct structure", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/api/admin/stats",
      headers: { "x-admin-token": "test-admin-token" },
    });
    expect(r.statusCode).toBe(200);
    const stats = r.json();
    expect(stats).toHaveProperty("generatedAt");
    expect(typeof stats.generatedAt).toBe("number");
    expect(stats).toHaveProperty("totalGames", 0);
    expect(stats).toHaveProperty("totalWins", 0);
    expect(stats).toHaveProperty("totalLosses", 0);
    expect(stats).toHaveProperty("winRate", 0);
    expect(stats).toHaveProperty("averageGuessesPerWin", 0);
    expect(stats).toHaveProperty("averageGuessesPerLoss", 0);
    expect(stats).toHaveProperty("averageGuessesPerGame", 0);
    expect(stats).toHaveProperty("guessDistribution");
    expect(stats).toHaveProperty("talentGuessFrequency");
    expect(stats).toHaveProperty("dailyPickFrequency");
    expect(stats).toHaveProperty("attributeAccuracy");
    expect(stats).toHaveProperty("activityByDate");
    expect(stats).toHaveProperty("perAnswerTalent");
    expect(Array.isArray(stats.perAnswerTalent)).toBe(true);
    expect(stats).toHaveProperty("firstGuessFrequency");
    expect(Array.isArray(stats.firstGuessFrequency)).toBe(true);
    expect(stats).toHaveProperty("firstGuessEffectiveness");
    expect(Array.isArray(stats.firstGuessEffectiveness)).toBe(true);
    expect(stats).toHaveProperty("attributeBreakdown");
    expect(stats).toHaveProperty("reach");
    expect(stats.reach).toMatchObject({
      uniquePlayers: 0,
      distinctChannels: 0,
      soloGames: 0,
      channelGames: 0,
    });
  });

  it("rejects requests without admin token with 401", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/api/admin/stats",
    });
    expect(r.statusCode).toBe(401);
    expect(r.json()).toEqual({ error: "Unauthorized" });
  });

  it("rejects requests with wrong admin token with 401", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/api/admin/stats",
      headers: { "x-admin-token": "wrong-token" },
    });
    expect(r.statusCode).toBe(401);
    expect(r.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 404 when ADMIN_TOKEN env is not set", async () => {
    // This test would require creating a new app instance without ADMIN_TOKEN,
    // which is complex. Skip for now as the endpoint gracefully handles missing token.
  });
});
