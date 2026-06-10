import { describe, expect, it } from "vitest";
import type { Talent } from "@holodle/shared";
import { attributeUsefulness, exploreBestGuess } from "../src/game/bestGuess.js";
import { feedbackKey } from "../src/game/feedback.js";
import { compareGuess } from "../src/game/compare.js";

function t(overrides: Partial<Talent> & { id: string }): Talent {
  return {
    name: overrides.id,
    avatarUrl: "/x.png",
    branch: "JP",
    generation: "Gen 1",
    debutYear: 2020,
    archetype: "Human",
    penlightColor: "Red",
    heightCm: 155,
    birthMonth: "June",
    active: true,
    ...overrides,
  };
}

// Four talents: months split them 2/2; penlight uniquely identifies each;
// every other attribute is constant across the set.
const POOL: Talent[] = [
  t({ id: "a", penlightColor: "Red", birthMonth: "June" }),
  t({ id: "b", penlightColor: "Blue", birthMonth: "June" }),
  t({ id: "c", penlightColor: "Green", birthMonth: "July" }),
  t({ id: "d", penlightColor: "White", birthMonth: "July" }),
];
const REGISTRY = {
  all: POOL,
  activePool: POOL,
  byId: new Map(POOL.map((x) => [x.id, x])),
};

describe("attributeUsefulness", () => {
  const u = attributeUsefulness(POOL, POOL);

  it("gives 0 bits to attributes constant across the pool", () => {
    expect(u.branch).toBe(0);
    expect(u.group).toBe(0);
    expect(u.archetype).toBe(0);
    expect(u.height).toBe(0);
  });

  it("ranks the unique attribute above the 2/2 split", () => {
    // Penlight: every guess splits 1 green / 3 red → H = 0.811 bits.
    // Month: every guess splits 2/2 → H = 1 bit. Month wins here because a
    // unique attribute's green bucket is tiny; the entropy reflects that.
    expect(u.birthMonth).toBeCloseTo(1, 5);
    expect(u.penlightColor).toBeCloseTo(0.811, 2);
    expect(u.birthMonth).toBeGreaterThan(u.penlightColor);
  });
});

describe("exploreBestGuess", () => {
  it("start of game: candidates = full active pool", () => {
    const r = exploreBestGuess(null, "", REGISTRY);
    expect(r.candidates.sort()).toEqual(["a", "b", "c", "d"]);
    expect(r.suggestions.length).toBeGreaterThan(0);
    // Any opener splits the pool into {itself}, {same-month other}, and the
    // other-month pair (their penlights both grade X, so they can't be told
    // apart) → buckets 1/1/2 → E[rem] = (1+1+4)/4 = 1.5.
    expect(r.suggestions[0]?.expectedRemaining).toBe(1.5);
    expect(r.suggestions[0]?.isCandidate).toBe(true);
  });

  it("filters candidates to those consistent with the feedback", () => {
    // Guess "a", feedback: month green, all else red except the constants
    // (branch/group/archetype/height are equal across the pool, so a real
    // diff always has them green). Build the expected key from compareGuess.
    const key = feedbackKey(compareGuess(POOL[0]!, POOL[1]!)); // a vs b
    const r = exploreBestGuess("a", key, REGISTRY);
    // b shares a's month but not penlight; only b matches this pattern.
    expect(r.candidates).toEqual(["b"]);
    expect(r.suggestions[0]?.talentId).toBe("b");
    expect(r.suggestions[0]?.expectedRemaining).toBe(1);
  });

  it("returns empty for a pattern nothing satisfies", () => {
    // All-X is impossible here (constants always grade equal).
    const r = exploreBestGuess("a", "XXXXXX", REGISTRY);
    expect(r.candidates).toEqual([]);
    expect(r.suggestions).toEqual([]);
  });

  it("throws on an unknown guess id", () => {
    expect(() => exploreBestGuess("nope", "EEEEEE", REGISTRY)).toThrow(/Unknown talent/);
  });
});
