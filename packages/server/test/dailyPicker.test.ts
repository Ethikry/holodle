import { describe, expect, it } from "vitest";
import type { Talent } from "@holodle/shared";
import {
  EPOCH_UTC_MS,
  cstDayIndexFor,
  dayIndexFor,
  pickDaily,
  puzzleIdFor,
  safeTz,
} from "../src/game/dailyPicker.js";

function t(id: string): Talent {
  return {
    id,
    name: id,
    avatarUrl: `/avatars/${id}.png`,
    branch: "JP",
    generation: "Gen 0",
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
    expect(pickDaily([], EPOCH_UTC_MS, "UTC")).toBeNull();
  });

  it("is deterministic for the same (now, tz)", () => {
    const pool = ["a", "b", "c", "d", "e"].map(t);
    const day = EPOCH_UTC_MS + 7 * ONE_DAY;
    expect(pickDaily(pool, day, "UTC")).toEqual(pickDaily(pool, day, "UTC"));
    expect(pickDaily(pool, day, "America/Chicago")).toEqual(
      pickDaily(pool, day, "America/Chicago"),
    );
  });

  it("visits each talent exactly once across pool.length days (UTC)", () => {
    const pool = ["a", "b", "c", "d", "e"].map(t);
    const seen = new Set<string>();
    for (let i = 0; i < pool.length; i++) {
      const pick = pickDaily(pool, EPOCH_UTC_MS + i * ONE_DAY, "UTC");
      expect(pick).not.toBeNull();
      seen.add(pick!.id);
    }
    expect(seen.size).toBe(pool.length);
  });
});

describe("dayIndexFor", () => {
  it("UTC: advances by 1 every 24h from EPOCH", () => {
    expect(dayIndexFor(EPOCH_UTC_MS, "UTC")).toBe(0);
    expect(dayIndexFor(EPOCH_UTC_MS + ONE_DAY - 1, "UTC")).toBe(0);
    expect(dayIndexFor(EPOCH_UTC_MS + ONE_DAY, "UTC")).toBe(1);
  });

  it("different timezones bucket the same wall-clock to different days", () => {
    // 2024-05-19T06:00:00Z. In Asia/Tokyo (UTC+9) it's already 15:00 May 19.
    // In Pacific/Honolulu (UTC-10) it's still 20:00 May 18.
    const t = Date.UTC(2024, 4, 19, 6, 0, 0);
    const tokyo = dayIndexFor(t, "Asia/Tokyo");
    const honolulu = dayIndexFor(t, "Pacific/Honolulu");
    expect(tokyo).toBe(honolulu + 1);
  });

  it("DST spring-forward (America/Chicago, 2024-03-10) doesn't double-count or skip", () => {
    // Before DST: 2024-03-09 23:00 CT (= UTC 2024-03-10 05:00). After
    // spring-forward: 2024-03-10 03:30 CDT (= UTC 2024-03-10 08:30). Both
    // should resolve to consecutive dayIndexes (not the same, not a gap).
    const before = Date.UTC(2024, 2, 10, 5, 0, 0);
    const after = Date.UTC(2024, 2, 10, 8, 30, 0);
    expect(dayIndexFor(after, "America/Chicago") - dayIndexFor(before, "America/Chicago")).toBe(1);
  });

  it("DST fall-back (America/Chicago, 2024-11-03) doesn't double-count or skip", () => {
    // 2024-11-03 00:30 CDT (UTC 05:30) and 2024-11-03 02:30 CST (UTC 08:30).
    // Same local calendar date → same dayIndex.
    const beforeFallback = Date.UTC(2024, 10, 3, 5, 30, 0);
    const afterFallback = Date.UTC(2024, 10, 3, 8, 30, 0);
    expect(dayIndexFor(beforeFallback, "America/Chicago")).toBe(
      dayIndexFor(afterFallback, "America/Chicago"),
    );
  });
});

describe("safeTz", () => {
  it("accepts known IANA zones", () => {
    expect(safeTz("America/Chicago")).toBe("America/Chicago");
    expect(safeTz("Asia/Tokyo")).toBe("Asia/Tokyo");
  });
  it("falls back to UTC for missing/invalid", () => {
    expect(safeTz(undefined)).toBe("UTC");
    expect(safeTz("")).toBe("UTC");
    expect(safeTz("Not/A_Real_Zone")).toBe("UTC");
  });
});

describe("cstDayIndexFor", () => {
  it("matches dayIndexFor(now, 'America/Chicago')", () => {
    const t = Date.UTC(2024, 4, 19, 6, 0, 0);
    expect(cstDayIndexFor(t)).toBe(dayIndexFor(t, "America/Chicago"));
  });
});

describe("puzzleIdFor", () => {
  it("renders YYYY-MM-DD in the given timezone", () => {
    // 2024-05-19T06:00:00Z = 2024-05-19 in UTC, 2024-05-19 in Tokyo,
    // 2024-05-18 in Honolulu (because UTC-10 hasn't ticked over yet).
    const t = Date.UTC(2024, 4, 19, 6, 0, 0);
    expect(puzzleIdFor(t, "UTC")).toBe("2024-05-19");
    expect(puzzleIdFor(t, "Asia/Tokyo")).toBe("2024-05-19");
    expect(puzzleIdFor(t, "Pacific/Honolulu")).toBe("2024-05-18");
  });
});
