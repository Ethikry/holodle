import { describe, expect, it } from "vitest";
import type { Talent } from "@holodle/shared";
import { compareGuess, displayGroup, heightBucket } from "../src/game/compare.js";

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

describe("displayGroup label formatting", () => {
  // Branch goes on line 1, generation on line 2 (separated by "\n"). The
  // cell CSS uses `white-space: pre-line` so the literal newline becomes
  // a hard break in the rendered chip — this makes partial-match state
  // (only branch OR only gen matches) visually obvious.
  it("formats numbered gens as 'BRANCH\\nGen N'", () => {
    expect(displayGroup("JP", "Gen 0")).toBe("JP\nGen 0");
    expect(displayGroup("JP", "Gen 5")).toBe("JP\nGen 5");
    expect(displayGroup("ID", "Gen 3")).toBe("ID\nGen 3");
  });
  it("synthesizes numbered gens for un-numbered cohorts with the original name in parens", () => {
    expect(displayGroup("JP", "holoX")).toBe("JP\nGen 6 (holoX)");
    expect(displayGroup("EN", "Myth")).toBe("EN\nGen 1 (Myth)");
    expect(displayGroup("EN", "Promise")).toBe("EN\nGen 2 (Promise)");
    expect(displayGroup("EN", "Council")).toBe("EN\nGen 2 (Promise)");
    expect(displayGroup("EN", "Advent")).toBe("EN\nGen 3 (Advent)");
    expect(displayGroup("EN", "Justice")).toBe("EN\nGen 4 (Justice)");
    expect(displayGroup("DEV_IS", "ReGLOSS")).toBe("DEV_IS\nGen 1 (ReGLOSS)");
    expect(displayGroup("DEV_IS", "FLOW GLOW")).toBe("DEV_IS\nGen 2 (FLOWGLOW)");
  });
  it("falls through unknown gens unchanged (no mapping required for GAMERS, Project: HOPE)", () => {
    expect(displayGroup("JP", "GAMERS")).toBe("JP\nGAMERS");
    expect(displayGroup("EN", "Project: HOPE")).toBe("EN\nProject: HOPE");
  });
  it("joins multi-group talents with ' / ' inside the gen line (branch alone on line 1)", () => {
    expect(displayGroup("JP", ["Gen 1", "GAMERS"])).toBe("JP\nGen 1 / GAMERS");
  });
});

describe("compareGuess", () => {
  it("flags an exact match green everywhere", () => {
    const a = t({ id: "kobo", name: "Kobo" });
    const diff = compareGuess(a, a);
    expect(diff.group.state).toBe("equal");
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

  it("birthMonth: equal or wrong (no higher/lower direction)", () => {
    const target = t({ birthMonth: "June" });
    expect(compareGuess(t({ birthMonth: "June" }), target).birthMonth.state).toBe("equal");
    expect(compareGuess(t({ birthMonth: "January" }), target).birthMonth.state).toBe("wrong");
    expect(compareGuess(t({ birthMonth: "July" }), target).birthMonth.state).toBe("wrong");
    expect(compareGuess(t({ birthMonth: "December" }), target).birthMonth.state).toBe("wrong");
  });

  it("group: equal when both branch AND generation match", () => {
    const target = t({ branch: "JP", generation: "Gen 3" });
    expect(compareGuess(t({ branch: "JP", generation: "Gen 3" }), target).group.state).toBe("equal");
  });

  it("group: partial when only branch matches", () => {
    const target = t({ branch: "JP", generation: "Gen 3" });
    const diff = compareGuess(t({ branch: "JP", generation: "Gen 4" }), target);
    expect(diff.group.state).toBe("partial");
    expect(diff.group.value).toBe("JP\nGen 4");
  });

  it("group: partial when only generation matches across branches", () => {
    // Both ID and JP have a "Gen 1" — the gen string overlaps but branch differs.
    const target = t({ branch: "JP", generation: "Gen 1" });
    const diff = compareGuess(t({ branch: "ID", generation: "Gen 1" }), target);
    expect(diff.group.state).toBe("partial");
    expect(diff.group.value).toBe("ID\nGen 1");
  });

  it("group: wrong when neither matches", () => {
    const target = t({ branch: "JP", generation: "Gen 3" });
    expect(
      compareGuess(t({ branch: "EN", generation: "Myth" }), target).group.state,
    ).toBe("wrong");
  });

  it("group: multi-group talents like Fubuki (JP Gen 1 + GAMERS) match any overlap", () => {
    const fubuki = t({ branch: "JP", generation: ["Gen 1", "GAMERS"] });
    // Guessing Aki (JP Gen 1) — branch matches AND Gen 1 overlap → equal.
    const aki = t({ branch: "JP", generation: "Gen 1" });
    expect(compareGuess(aki, fubuki).group.state).toBe("equal");
    // Guessing Mio (JP GAMERS) — branch matches AND GAMERS overlap → equal.
    const mio = t({ branch: "JP", generation: "GAMERS" });
    expect(compareGuess(mio, fubuki).group.state).toBe("equal");
    // Reverse direction (guessing Fubuki against an Aki target) — same.
    expect(compareGuess(fubuki, aki).group.state).toBe("equal");
    expect(compareGuess(fubuki, aki).group.value).toBe("JP\nGen 1 / GAMERS");
  });

  it("group: Council ↔ Promise are treated as the same cohort", () => {
    const sana = t({ branch: "EN", generation: "Council" });
    const mumei = t({ branch: "EN", generation: "Promise" });
    expect(compareGuess(sana, mumei).group.state).toBe("equal");
    expect(compareGuess(mumei, sana).group.state).toBe("equal");
  });

  it("archetype: multi-archetype talents match on any shared label (Nerissa: Bird + Demon)", () => {
    const nerissa = t({ archetype: ["Bird", "Demon"] });
    expect(compareGuess(t({ archetype: "Bird" }), nerissa).archetype.state).toBe("equal");
    expect(compareGuess(t({ archetype: "Demon" }), nerissa).archetype.state).toBe("equal");
    expect(compareGuess(t({ archetype: "Human" }), nerissa).archetype.state).toBe("wrong");
  });
});
