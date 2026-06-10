import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GuessDiff } from "@holodle/shared";

// env before importing the db module (it reads DB_PATH at first getDb()).
const tmpDir = mkdtempSync(join(tmpdir(), "holodle-admin-db-test-"));
process.env.DB_PATH = join(tmpDir, "test.db");
process.env.NODE_ENV = "test";

const {
  saveUserDay,
  insertPickLog,
  getSecondGuessFrequency,
  getGuessDistributionByOutcome,
  getNextGuessByFeedback,
  getTalentGuessFrequency,
} = await import("../src/db/client.js");

// Build a GuessDiff with all six attributes "wrong" by default; `arch` overrides
// just the archetype cell so we can exercise the partial (P) pattern encoding.
function gd(talentId: string, arch: "equal" | "partial" | "wrong" = "wrong"): GuessDiff {
  const wrong = (value: string) => ({ value, state: "wrong" as const });
  return {
    talentId,
    branch: wrong("JP"),
    group: wrong("Gen 1"),
    penlightColor: wrong("Red"),
    archetype: { value: "Human", state: arch },
    height: wrong("Med"),
    birthMonth: wrong("August"),
  };
}

function seed(
  userId: string,
  dayIndex: number,
  status: "won" | "lost",
  guesses: GuessDiff[],
): void {
  saveUserDay({
    userId,
    dayIndex,
    guesses,
    status,
    channelId: null,
    tz: null,
    settledAt: 1000 + dayIndex,
    exitEmbedPosted: false,
    endlessOffset: 0,
  });
}

beforeAll(() => {
  // Day 1 answer = marine; two 3-guess wins opening haato → fubuki → marine.
  insertPickLog(1, "marine");
  seed("u1", 1, "won", [gd("haato"), gd("fubuki"), gd("marine", "equal")]);
  seed("u3", 1, "won", [gd("haato"), gd("fubuki"), gd("marine", "equal")]);
  // Day 2 answer = pekora; a 2-guess loss opening haato → subaru.
  insertPickLog(2, "pekora");
  seed("u2", 2, "lost", [gd("haato"), gd("subaru")]);
  // Day 3 answer = korone; a 2-guess win whose opener returns a PARTIAL
  // archetype, so haato is logged under a different feedback pattern here.
  insertPickLog(3, "korone");
  seed("u4", 3, "won", [gd("haato", "partial"), gd("korone", "equal")]);
});

afterAll(() => rmSync(tmpDir, { recursive: true, force: true }));

describe("getSecondGuessFrequency", () => {
  it("counts guesses[1] across games, sorted desc", () => {
    const rows = getSecondGuessFrequency();
    const map = Object.fromEntries(rows.map((r) => [r.talentId, r.count]));
    expect(map.fubuki).toBe(2);
    expect(map.subaru).toBe(1);
    expect(map.korone).toBe(1);
    expect(rows[0]?.talentId).toBe("fubuki"); // highest first
  });
});

describe("getGuessDistributionByOutcome", () => {
  it("buckets settled games by guess count, split by outcome", () => {
    const d = getGuessDistributionByOutcome();
    expect(d.win[3]).toBe(2); // two 3-guess wins
    expect(d.win[2]).toBe(1); // one 2-guess win
    expect(d.loss[2]).toBe(1); // one 2-guess loss
    expect(d.loss[3]).toBe(0);
  });
});

describe("getTalentGuessFrequency", () => {
  it("nonAnswer excludes self-answer winning guesses", () => {
    const m = getTalentGuessFrequency();
    expect(m.get("marine")).toEqual({ total: 2, nonAnswer: 0 }); // answer both days guessed
    expect(m.get("korone")).toEqual({ total: 1, nonAnswer: 0 }); // answer on its day
    expect(m.get("haato")).toEqual({ total: 4, nonAnswer: 4 }); // never an answer
    expect(m.get("subaru")).toEqual({ total: 1, nonAnswer: 1 });
  });
});

describe("getNextGuessByFeedback", () => {
  it("keys by the earlier guess's E/P/X pattern and tallies the next guess", () => {
    const map = getNextGuessByFeedback();
    // haato/fubuki feedback (all wrong) → "XXXXXX".
    const allWrong = Object.fromEntries((map.XXXXXX ?? []).map((r) => [r.talentId, r.count]));
    expect(allWrong.fubuki).toBe(2); // haato → fubuki, twice
    expect(allWrong.subaru).toBe(1); // haato → subaru
    expect(allWrong.marine).toBe(2); // fubuki → marine, twice
    // The partial-archetype opener encodes as "XXXPXX" (archetype is index 3).
    const partial = Object.fromEntries((map.XXXPXX ?? []).map((r) => [r.talentId, r.count]));
    expect(partial.korone).toBe(1);
  });
});
