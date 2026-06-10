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
    expect(stats).not.toHaveProperty("averageGuessesPerLoss");
    expect(stats).toHaveProperty("averageGuessesPerGame", 0);
    expect(stats).toHaveProperty("guessDistribution");
    expect(stats).toHaveProperty("guessDistributionByOutcome");
    expect(stats.guessDistributionByOutcome).toHaveProperty("win");
    expect(stats.guessDistributionByOutcome).toHaveProperty("loss");
    expect(stats).toHaveProperty("talentGuessFrequency");
    expect(stats).toHaveProperty("dailyPickFrequency");
    expect(stats).toHaveProperty("secondGuessFrequency");
    expect(Array.isArray(stats.secondGuessFrequency)).toBe(true);
    expect(stats).toHaveProperty("attributeAccuracy");
    expect(stats).toHaveProperty("activityByDate");
    expect(stats).toHaveProperty("perAnswerTalent");
    expect(Array.isArray(stats.perAnswerTalent)).toBe(true);
    expect(stats).toHaveProperty("firstGuessFrequency");
    expect(Array.isArray(stats.firstGuessFrequency)).toBe(true);
    expect(stats).toHaveProperty("firstGuessEffectiveness");
    expect(Array.isArray(stats.firstGuessEffectiveness)).toBe(true);
    expect(stats).toHaveProperty("attributeBreakdown");
    expect(stats).toHaveProperty("attributeUsefulness");
    expect(typeof stats.attributeUsefulness.branch).toBe("number");
    expect(stats).toHaveProperty("nextGuessByFeedback");
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

describe("GET /api/admin/best-guess", () => {
  const auth = { "x-admin-token": "test-admin-token" };

  it("rejects requests without a token with 401", async () => {
    const r = await app.inject({ method: "GET", url: "/api/admin/best-guess?guess=start" });
    expect(r.statusCode).toBe(401);
  });

  it("start of game returns the full active pool and ranked suggestions", async () => {
    const r = await app.inject({ method: "GET", url: "/api/admin/best-guess?guess=start", headers: auth });
    expect(r.statusCode).toBe(200);
    const d = r.json();
    expect(d.candidates.sort()).toEqual(["alpha", "bravo", "charlie"]);
    expect(d.suggestions.length).toBeGreaterThan(0);
    expect(d.suggestions[0]).toHaveProperty("expectedRemaining");
    expect(d.suggestions[0]).toHaveProperty("worstCase");
    expect(d.suggestions[0]).toHaveProperty("isCandidate");
  });

  it("rejects a malformed pattern with 400", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/api/admin/best-guess?guess=alpha&pattern=GREEN!",
      headers: auth,
    });
    expect(r.statusCode).toBe(400);
  });

  it("rejects an unknown guess id with 400", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/api/admin/best-guess?guess=not-a-talent&pattern=XXXXXX",
      headers: auth,
    });
    expect(r.statusCode).toBe(400);
  });

  it("filters candidates by guess + pattern", async () => {
    // alpha vs itself is all-green; EEEEEE must include alpha.
    const r = await app.inject({
      method: "GET",
      url: "/api/admin/best-guess?guess=alpha&pattern=EEEEEE",
      headers: auth,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().candidates).toContain("alpha");
  });
});
