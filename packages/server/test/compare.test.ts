import { describe, expect, it } from "vitest";
import type { Talent } from "@holodle/shared";
import { compareGuess, heightBucket } from "../src/game/compare.js";

function t(overrides: Partial<Talent>): Talent {
  return {
    id: "a",
    name: "A",
    avatarUrl: "/avatars/a.png",
    branch: "JP",
    debutYear: 2020,
    archetype: "Human",
    heightCm: 155,
    birthMonth: "June",
    active: true,
    ...overrides,
  };
}

describe("heightBucket", () => {
  it.each([
    [149, "Small"],
    [150, "Med"],
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
    expect(diff.name.state).toBe("equal");
    expect(diff.branch.state).toBe("equal");
    expect(diff.debutYear.state).toBe("equal");
    expect(diff.archetype.state).toBe("equal");
    expect(diff.height.state).toBe("equal");
    expect(diff.birthMonth.state).toBe("equal");
  });

  it("debutYear: equal / near / higher / lower", () => {
    const target = t({ debutYear: 2022 });
    expect(compareGuess(t({ debutYear: 2022 }), target).debutYear.state).toBe("equal");
    expect(compareGuess(t({ debutYear: 2021 }), target).debutYear.state).toBe("near");
    expect(compareGuess(t({ debutYear: 2023 }), target).debutYear.state).toBe("near");
    // 2018 vs 2022 — guess is lower, target is higher → "higher"
    expect(compareGuess(t({ debutYear: 2018 }), target).debutYear.state).toBe("higher");
    expect(compareGuess(t({ debutYear: 2026 }), target).debutYear.state).toBe("lower");
  });

  it("height buckets: equal / near (adjacent) / wrong (non-adjacent)", () => {
    const target = t({ heightCm: 155 }); // Med
    expect(compareGuess(t({ heightCm: 156 }), target).height.state).toBe("equal");
    expect(compareGuess(t({ heightCm: 145 }), target).height.state).toBe("near"); // Small adj Med
    expect(compareGuess(t({ heightCm: 170 }), target).height.state).toBe("near"); // Tall adj Med
    // Small vs Tall — non-adjacent
    const tall = t({ heightCm: 170 });
    expect(compareGuess(t({ heightCm: 140 }), tall).height.state).toBe("wrong");
  });

  it("birthMonth: equal / near with wrap-around / wrong", () => {
    const target = t({ birthMonth: "December" });
    expect(compareGuess(t({ birthMonth: "December" }), target).birthMonth.state).toBe("equal");
    expect(compareGuess(t({ birthMonth: "November" }), target).birthMonth.state).toBe("near");
    expect(compareGuess(t({ birthMonth: "January" }), target).birthMonth.state).toBe("near");
    expect(compareGuess(t({ birthMonth: "June" }), target).birthMonth.state).toBe("wrong");
  });

  it("branch and archetype: equal / wrong", () => {
    const target = t({ branch: "ID", archetype: "Human" });
    expect(compareGuess(t({ branch: "ID", archetype: "Human" }), target).branch.state).toBe("equal");
    expect(compareGuess(t({ branch: "JP", archetype: "Zombie" }), target).branch.state).toBe("wrong");
    expect(compareGuess(t({ branch: "JP", archetype: "Zombie" }), target).archetype.state).toBe("wrong");
  });
});
