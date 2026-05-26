import { describe, expect, it } from "vitest";
import type { Talent } from "@holodle/shared";
import { compareGuess, heightBucket } from "../src/game/compare.js";

function t(overrides: Partial<Talent>): Talent {
  return {
    id: "a",
    name: "A",
    avatarUrl: "/avatars/a.png",
    branch: "JP",
    generation: "Gen 0",
    debutYear: 2020,
    archetype: "Human",
    penlightColor: "Blue",
    heightCm: 155,
    birthMonth: "June",
    active: true,
    ...overrides,
  };
}

describe("heightBucket", () => {
  // ≤150 Smol, 151–160 Med, >160 Tall. 150 itself is Smol.
  it.each([
    [149, "Smol"],
    [150, "Smol"],
    [151, "Med"],
    [155, "Med"],
    [160, "Med"],
    [161, "Tall"],
  ])("%i → %s", (cm, bucket) => {
    expect(heightBucket(cm)).toBe(bucket);
  });
});

describe("compareGuess", () => {
  it("flags an exact match green everywhere", () => {
    const a = t({ id: "kobo", name: "Kobo" });
    const diff = compareGuess(a, a);
    expect(diff.generation.state).toBe("equal");
    expect(diff.branch.state).toBe("equal");
    expect(diff.penlightColor.state).toBe("equal");
    expect(diff.archetype.state).toBe("equal");
    expect(diff.height.state).toBe("equal");
    expect(diff.birthMonth.state).toBe("equal");
  });

  it("penlightColor: exact-match string (null/None only matches None)", () => {
    const blue = t({ penlightColor: "Blue" });
    expect(compareGuess(t({ penlightColor: "Blue" }), blue).penlightColor.state).toBe("equal");
    expect(compareGuess(t({ penlightColor: "Red" }), blue).penlightColor.state).toBe("wrong");

    const noColor = t({ penlightColor: null });
    expect(compareGuess(t({ penlightColor: null }), noColor).penlightColor.state).toBe("equal");
    expect(compareGuess(t({ penlightColor: "Red" }), noColor).penlightColor.state).toBe("wrong");
    expect(compareGuess(t({ penlightColor: null }), blue).penlightColor.state).toBe("wrong");
  });

  it("height buckets: equal or wrong only — no adjacency credit", () => {
    const target = t({ heightCm: 155 }); // Med
    expect(compareGuess(t({ heightCm: 156 }), target).height.state).toBe("equal"); // both Med
    expect(compareGuess(t({ heightCm: 145 }), target).height.state).toBe("wrong"); // Smol vs Med
    expect(compareGuess(t({ heightCm: 170 }), target).height.state).toBe("wrong"); // Tall vs Med
    const tall = t({ heightCm: 170 });
    expect(compareGuess(t({ heightCm: 140 }), tall).height.state).toBe("wrong"); // Smol vs Tall
  });

  it("birthMonth: equal / higher / lower (linear by calendar order, no wrap)", () => {
    const target = t({ birthMonth: "June" });
    expect(compareGuess(t({ birthMonth: "June" }), target).birthMonth.state).toBe("equal");
    // Target (June) is later in the year than guess → ↑ "higher".
    expect(compareGuess(t({ birthMonth: "January" }), target).birthMonth.state).toBe("higher");
    expect(compareGuess(t({ birthMonth: "May" }), target).birthMonth.state).toBe("higher");
    // Target (June) is earlier than guess → ↓ "lower".
    expect(compareGuess(t({ birthMonth: "July" }), target).birthMonth.state).toBe("lower");
    expect(compareGuess(t({ birthMonth: "December" }), target).birthMonth.state).toBe("lower");

    // No wrap-around: guessing January against December is "lower" (Jan < Dec),
    // not "higher" (which would imply Dec is ~1 month after Jan).
    const dec = t({ birthMonth: "December" });
    expect(compareGuess(t({ birthMonth: "January" }), dec).birthMonth.state).toBe("higher");
    expect(compareGuess(t({ birthMonth: "November" }), dec).birthMonth.state).toBe("higher");
  });

  it("generation: equal or wrong (string compared exactly)", () => {
    const target = t({ generation: "Gen 3" });
    expect(compareGuess(t({ generation: "Gen 3" }), target).generation.state).toBe("equal");
    expect(compareGuess(t({ generation: "Gen 4" }), target).generation.state).toBe("wrong");
    expect(compareGuess(t({ generation: "GAMERS" }), target).generation.state).toBe("wrong");
  });

  it("generation: multi-group talents match on any shared label (Fubuki: Gen 1 + GAMERS)", () => {
    const fubuki = t({ generation: ["Gen 1", "GAMERS"] });
    // Guessing a single-group talent that shares one of Fubuki's labels.
    expect(compareGuess(t({ generation: "Gen 1" }), fubuki).generation.state).toBe("equal");
    expect(compareGuess(t({ generation: "GAMERS" }), fubuki).generation.state).toBe("equal");
    // No overlap → wrong.
    expect(compareGuess(t({ generation: "Gen 2" }), fubuki).generation.state).toBe("wrong");
    // And the reverse: guessing Fubuki against a Gen 1 target also matches.
    const aki = t({ generation: "Gen 1" });
    expect(compareGuess(fubuki, aki).generation.state).toBe("equal");
    // Display value carries the guess's labels joined.
    expect(compareGuess(fubuki, aki).generation.value).toBe("Gen 1 / GAMERS");
  });

  it("archetype: multi-archetype talents match on any shared label (Nerissa: Bird + Demon)", () => {
    const nerissa = t({ archetype: ["Bird", "Demon"] });
    expect(compareGuess(t({ archetype: "Bird" }), nerissa).archetype.state).toBe("equal");
    expect(compareGuess(t({ archetype: "Demon" }), nerissa).archetype.state).toBe("equal");
    expect(compareGuess(t({ archetype: "Human" }), nerissa).archetype.state).toBe("wrong");
  });

  it("branch and archetype: equal or wrong", () => {
    const target = t({ branch: "ID", archetype: "Human" });
    expect(compareGuess(t({ branch: "ID", archetype: "Human" }), target).branch.state).toBe("equal");
    expect(compareGuess(t({ branch: "JP", archetype: "Zombie" }), target).branch.state).toBe("wrong");
    expect(compareGuess(t({ branch: "JP", archetype: "Zombie" }), target).archetype.state).toBe("wrong");
  });
});
