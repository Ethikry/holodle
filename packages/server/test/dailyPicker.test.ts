import { describe, expect, it } from "vitest";
import type { Talent } from "@holodle/shared";
import { EPOCH_UTC_MS, dayIndexFor, pickDaily } from "../src/game/dailyPicker.js";

function t(id: string): Talent {
  return {
    id,
    name: id,
    avatarUrl: `/avatars/${id}.png`,
    branch: "JP",
    debutYear: 2020,
    archetype: "Human",
    heightCm: 155,
    birthMonth: "June",
    active: true,
  };
}

const ONE_DAY = 86_400_000;

describe("pickDaily", () => {
  it("returns null for an empty pool", () => {
    expect(pickDaily([], EPOCH_UTC_MS)).toBeNull();
  });

  it("is deterministic for the same dayIndex", () => {
    const pool = ["a", "b", "c", "d", "e"].map(t);
    const day = EPOCH_UTC_MS + 7 * ONE_DAY;
    expect(pickDaily(pool, day)).toEqual(pickDaily(pool, day));
  });

  it("visits each talent exactly once across pool.length days", () => {
    const pool = ["a", "b", "c", "d", "e"].map(t);
    const seen = new Set<string>();
    for (let i = 0; i < pool.length; i++) {
      const pick = pickDaily(pool, EPOCH_UTC_MS + i * ONE_DAY);
      expect(pick).not.toBeNull();
      seen.add(pick!.id);
    }
    expect(seen.size).toBe(pool.length);
  });

  it("dayIndexFor advances by 1 every 24h", () => {
    const base = EPOCH_UTC_MS;
    expect(dayIndexFor(base)).toBe(0);
    expect(dayIndexFor(base + ONE_DAY - 1)).toBe(0);
    expect(dayIndexFor(base + ONE_DAY)).toBe(1);
  });
});
