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
  // Cell shows the generation only (branch is no longer part of the
  // comparison or the displayed value). Numbered gens render as-is;
  // named cohorts render as "Gen N (CohortName)".
  it("formats numbered gens as 'Gen N'", () => {
    expect(displayGroup("JP", "Gen 0")).toBe("Gen 0");
    expect(displayGroup("JP", "Gen 5")).toBe("Gen 5");
    expect(displayGroup("ID", "Gen 3")).toBe("Gen 3");
  });
  it("synthesizes numbered labels for named cohorts", () => {
    expect(displayGroup("JP", "holoX")).toBe("Gen 6 (holoX)");
    expect(displayGroup("EN", "Myth")).toBe("Gen 1 (Myth)");
    expect(displayGroup("EN", "Promise")).toBe("Gen 2 (Promise)");
    expect(displayGroup("EN", "Council")).toBe("Gen 2 (Promise)");
    expect(displayGroup("EN", "Project: HOPE")).toBe("Gen 2 (Project HOPE)");
    expect(displayGroup("EN", "Advent")).toBe("Gen 3 (Advent)");
    expect(displayGroup("EN", "Justice")).toBe("Gen 4 (Justice)");
    expect(displayGroup("DEV_IS", "ReGLOSS")).toBe("Gen 1 (ReGLOSS)");
    expect(displayGroup("DEV_IS", "FLOW GLOW")).toBe("Gen 2 (FLOWGLOW)");
  });
  it("falls through unknown gens unchanged (GAMERS has no gen number)", () => {
    expect(displayGroup("JP", "GAMERS")).toBe("GAMERS");
  });
  it("joins multi-group talents with ' / '", () => {
    expect(displayGroup("JP", ["Gen 1", "GAMERS"])).toBe("Gen 1 / GAMERS");
  });
});

describe("compareGuess", () => {
  it("flags an exact match green everywhere", () => {
    const a = t({ id: "kobo", name: "Kobo" });
    const diff = compareGuess(a, a);
    expect(diff.branch.state).toBe("equal");
    expect(diff.group.state).toBe("equal");
    expect(diff.penlightColor.state).toBe("equal");
    expect(diff.archetype.state).toBe("equal");
    expect(diff.height.state).toBe("equal");
    expect(diff.birthMonth.state).toBe("equal");
  });

  it("branch: equal-or-wrong only; tracks the guess's branch on the chip", () => {
    const jp = t({ branch: "JP" });
    const en = t({ branch: "EN" });
    expect(compareGuess(jp, jp).branch).toEqual({ value: "JP", state: "equal" });
    expect(compareGuess(jp, en).branch).toEqual({ value: "JP", state: "wrong" });
    expect(compareGuess(en, jp).branch).toEqual({ value: "EN", state: "wrong" });
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

  // Generation cell is now BINARY (equal/wrong only). It matches by
  // gen number across branches — Aqua (JP Gen 2) and Fauna (EN Gen 2
  // (Promise)) both display "Gen 2" so they match.

  it("group: equal when the gen number matches (same branch)", () => {
    const target = t({ branch: "JP", generation: "Gen 3" });
    expect(compareGuess(t({ branch: "JP", generation: "Gen 3" }), target).group.state).toBe("equal");
  });

  it("group: equal across branches when the gen NUMBER agrees", () => {
    // Aqua (JP Gen 2) vs Fauna (EN Promise → Gen 2): both Gen 2 → equal.
    const aqua = t({ branch: "JP", generation: "Gen 2" });
    const fauna = t({ branch: "EN", generation: "Promise" });
    expect(compareGuess(aqua, fauna).group.state).toBe("equal");
    expect(compareGuess(fauna, aqua).group.state).toBe("equal");

    // Calliope (EN Myth → Gen 1) and Aki (JP Gen 1) — both Gen 1.
    const calli = t({ branch: "EN", generation: "Myth" });
    const aki = t({ branch: "JP", generation: "Gen 1" });
    expect(compareGuess(calli, aki).group.state).toBe("equal");
    expect(compareGuess(aki, calli).group.state).toBe("equal");
  });

  it("group: wrong when gen numbers don't agree, regardless of branch", () => {
    const target = t({ branch: "JP", generation: "Gen 3" });
    expect(
      compareGuess(t({ branch: "JP", generation: "Gen 4" }), target).group.state,
    ).toBe("wrong");
    expect(
      compareGuess(t({ branch: "EN", generation: "Myth" }), target).group.state,
    ).toBe("wrong");
  });

  it("group: multi-group talents (Fubuki: Gen 1 + GAMERS) match on any overlap", () => {
    const fubuki = t({ branch: "JP", generation: ["Gen 1", "GAMERS"] });
    const aki = t({ branch: "JP", generation: "Gen 1" });
    expect(compareGuess(aki, fubuki).group.state).toBe("equal");
    const mio = t({ branch: "JP", generation: "GAMERS" });
    expect(compareGuess(mio, fubuki).group.state).toBe("equal");
    expect(compareGuess(fubuki, aki).group.state).toBe("equal");
    expect(compareGuess(fubuki, aki).group.value).toBe("Gen 1 / GAMERS");
  });

  it("group: Project HOPE normalises to Gen 2 (matches Promise/Council)", () => {
    const hopeful = t({ branch: "EN", generation: "Project: HOPE" });
    const fauna = t({ branch: "EN", generation: "Promise" });
    expect(compareGuess(hopeful, fauna).group.state).toBe("equal");
    expect(compareGuess(hopeful, fauna).group.value).toBe("Gen 2 (Project HOPE)");
  });

  it("group: GAMERS only matches itself (no gen number, stays unmapped)", () => {
    const mio = t({ branch: "JP", generation: "GAMERS" });
    const aki = t({ branch: "JP", generation: "Gen 1" });
    expect(compareGuess(mio, aki).group.state).toBe("wrong");
    const fubuki = t({ branch: "JP", generation: ["Gen 1", "GAMERS"] });
    expect(compareGuess(mio, fubuki).group.state).toBe("equal");
  });

  it("group: Council ↔ Promise are still the same cohort", () => {
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
