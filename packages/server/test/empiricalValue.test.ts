import { describe, expect, it } from "vitest";
import type { GuessDiff, Talent } from "@holodle/shared";
import { compareGuess } from "../src/game/compare.js";
import { empiricalAttributeValue } from "../src/game/empiricalValue.js";

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

// Same synthetic pool as bestGuess.test.ts: penlight unique per talent,
// months split 2/2 (a,b June; c,d July), everything else constant.
const POOL: Talent[] = [
  t({ id: "a", penlightColor: "Red", birthMonth: "June" }),
  t({ id: "b", penlightColor: "Blue", birthMonth: "June" }),
  t({ id: "c", penlightColor: "Green", birthMonth: "July" }),
  t({ id: "d", penlightColor: "White", birthMonth: "July" }),
];
const REGISTRY = {
  activePool: POOL,
  byId: new Map(POOL.map((x) => [x.id, x])),
};

describe("empiricalAttributeValue", () => {
  it("scores per-attribute elimination bits, crediting red cells", () => {
    // One game: answer is "a"; player opens with "b", then wins with "a".
    const game = {
      guesses: [compareGuess(POOL[1]!, POOL[0]!), compareGuess(POOL[0]!, POOL[0]!)],
    };
    const v = empiricalAttributeValue([game], REGISTRY);

    // Guess 1 faces S=4. Constants (branch etc.) grade green for all 4
    // candidates → 0 bits. Guess 2 faces S={a} → everything 0 bits.
    expect(v.branch).toMatchObject({ guessesMeasured: 2, avgBits: 0, greenRate: 1 });

    // Penlight on guess 1 was RED (Blue≠Red): the 3 candidates that aren't
    // "b" survive → log2(4/3) bits despite no match. Guess 2 green, 0 bits.
    expect(v.penlightColor?.guessesMeasured).toBe(2);
    expect(v.penlightColor?.avgBits).toBeCloseTo(Math.log2(4 / 3) / 2, 6);
    expect(v.penlightColor?.greenRate).toBe(0.5);
    expect(v.penlightColor?.avgBitsWhenMiss).toBeCloseTo(Math.log2(4 / 3), 6);
    expect(v.penlightColor?.avgBitsWhenGreen).toBe(0);
    expect(v.penlightColor?.avgEliminationPct).toBeCloseTo(0.25 / 2, 6);

    // Month on guess 1 was GREEN (June=June): halves the pool → 1 bit.
    expect(v.birthMonth?.avgBits).toBeCloseTo(0.5, 6);
    expect(v.birthMonth?.greenRate).toBe(1);
    expect(v.birthMonth?.avgBitsWhenGreen).toBeCloseTo(0.5, 6);
  });

  it("skips unreproducible cells and abandons the game once S empties", () => {
    // Corrupt the opener's branch state to "partial" — branch can never
    // grade partial, so no candidate reproduces it.
    const corrupted = compareGuess(POOL[1]!, POOL[0]!);
    const game = {
      guesses: [
        { ...corrupted, branch: { ...corrupted.branch, state: "partial" } } as GuessDiff,
        compareGuess(POOL[0]!, POOL[0]!),
      ],
    };
    const v = empiricalAttributeValue([game], REGISTRY);
    // Branch cell skipped entirely; other attrs measured for guess 1 only —
    // the joint filter (requiring the impossible branch state) empties S, so
    // guess 2 is dropped.
    expect(v.branch?.guessesMeasured).toBe(0);
    expect(v.penlightColor?.guessesMeasured).toBe(1);
    expect(v.birthMonth?.guessesMeasured).toBe(1);
  });

  it("ignores guesses whose talent left the roster", () => {
    const ghost = compareGuess(POOL[1]!, POOL[0]!);
    const game = { guesses: [{ ...ghost, talentId: "graduated" } as GuessDiff] };
    const v = empiricalAttributeValue([game], REGISTRY);
    expect(v.branch?.guessesMeasured).toBe(0);
    expect(v.penlightColor?.guessesMeasured).toBe(0);
  });
});
