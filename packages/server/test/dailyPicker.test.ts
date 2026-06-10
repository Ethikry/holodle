import { describe, expect, it } from "vitest";
import type { Talent } from "@holodle/shared";
import {
  EPOCH_UTC_MS,
  NO_REPEAT_WINDOW,
  type PickLogDeps,
  RECENCY_EXPONENT,
  RECENCY_HORIZON_DAYS,
  cstDayIndexFor,
  dayIndexFor,
  pickAndLogDaily,
  pickByIndex,
  pickDaily,
  pickWeight,
  puzzleEndUtcSecs,
  puzzleIdFor,
  recencyWeight,
  safeTz,
  weightedPick,
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
    penlightColor: "Blue",
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

describe("pickByIndex 30-day no-repeat window", () => {
  // A fresh pool reference per test so we don't share the WeakMap memo
  // across tests. Each pool has a distinct identity even when contents
  // overlap, which is exactly what we want for isolation.
  const makePool = (ids: string[]) => ids.map((id) => t(id));

  it("never returns the same talent within a NO_REPEAT_WINDOW-day stretch", () => {
    const pool = makePool(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j",
      "k", "l", "m", "n", "o", "p", "q", "r", "s", "t",
      "u", "v", "w", "x", "y", "z", "aa", "bb", "cc", "dd",
      "ee", "ff", "gg", "hh", "ii", "jj"]);
    const recent: string[] = [];
    for (let day = 0; day < 120; day++) {
      const pick = pickByIndex(pool, day);
      expect(pick).not.toBeNull();
      // Within any 30-day window the id must not have appeared yet.
      const window = recent.slice(-NO_REPEAT_WINDOW);
      expect(window).not.toContain(pick!.id);
      recent.push(pick!.id);
    }
  });

  it("is deterministic — same dayIndex returns the same talent across calls", () => {
    const pool = makePool(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j",
      "k", "l", "m", "n", "o", "p", "q", "r", "s", "t",
      "u", "v", "w", "x", "y", "z", "aa", "bb", "cc", "dd", "ee"]);
    // Drive the picker forward then re-query in different order; results
    // must match.
    const a50 = pickByIndex(pool, 50);
    const a10 = pickByIndex(pool, 10);
    const a50again = pickByIndex(pool, 50);
    const a10again = pickByIndex(pool, 10);
    expect(a50?.id).toBe(a50again?.id);
    expect(a10?.id).toBe(a10again?.id);
  });

  it("on day 0 returns the canonical shuffled-pool head (no recents to skip)", () => {
    const pool = makePool(["a", "b", "c"]);
    const pick = pickByIndex(pool, 0);
    expect(pick).not.toBeNull();
    // The exact id depends on the shuffle seed; just assert it's IN the pool.
    expect(["a", "b", "c"]).toContain(pick!.id);
  });

  it("with a small pool (< NO_REPEAT_WINDOW), still returns a talent every day", () => {
    const pool = makePool(["a", "b", "c", "d"]);
    for (let day = 0; day < 10; day++) {
      const pick = pickByIndex(pool, day);
      expect(pick).not.toBeNull();
    }
  });

  it("returns null for an empty pool", () => {
    expect(pickByIndex([], 5)).toBeNull();
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

describe("puzzleEndUtcSecs", () => {
  // Helper to build an expected UTC second from a wall-clock UTC datetime.
  const utcSec = (y: number, m: number, d: number, h: number, min = 0) =>
    Math.floor(Date.UTC(y, m - 1, d, h, min) / 1000);

  it("UTC: midnight of the next day", () => {
    // Puzzle 2026-05-26 ends at 2026-05-27 00:00 UTC.
    expect(puzzleEndUtcSecs("2026-05-26", "UTC")).toBe(utcSec(2026, 5, 27, 0));
  });

  it("Asia/Tokyo (+09:00): 15:00 UTC of the next day", () => {
    // Local midnight in JST = UTC 15:00 the previous day.
    // So 2026-05-27 00:00 JST = 2026-05-26 15:00 UTC.
    expect(puzzleEndUtcSecs("2026-05-26", "Asia/Tokyo")).toBe(utcSec(2026, 5, 26, 15));
  });

  it("America/Chicago (CST, -06:00) in winter", () => {
    // 2026-01-15 00:00 CST = 2026-01-15 06:00 UTC. So puzzle 2026-01-14
    // ends at 2026-01-15 06:00 UTC.
    expect(puzzleEndUtcSecs("2026-01-14", "America/Chicago")).toBe(
      utcSec(2026, 1, 15, 6),
    );
  });

  it("America/Chicago (CDT, -05:00) in summer", () => {
    // 2026-07-15 00:00 CDT = 2026-07-15 05:00 UTC. So puzzle 2026-07-14
    // ends at 2026-07-15 05:00 UTC.
    expect(puzzleEndUtcSecs("2026-07-14", "America/Chicago")).toBe(
      utcSec(2026, 7, 15, 5),
    );
  });

  it("America/Los_Angeles (PDT, -07:00) in summer", () => {
    // 2026-07-15 00:00 PDT = 2026-07-15 07:00 UTC.
    expect(puzzleEndUtcSecs("2026-07-14", "America/Los_Angeles")).toBe(
      utcSec(2026, 7, 15, 7),
    );
  });

  it("DST spring-forward day (America/Chicago, 2026-03-08): midnight CST stays at 06:00 UTC", () => {
    // The spring-forward jump at 02:00 local doesn't move midnight itself
    // — local clocks tick over at 24:00 of the prior day normally. So
    // puzzle 2026-03-07 ends at 2026-03-08 06:00 UTC (still CST).
    expect(puzzleEndUtcSecs("2026-03-07", "America/Chicago")).toBe(
      utcSec(2026, 3, 8, 6),
    );
  });

  it("DST fall-back day (America/Chicago, 2026-11-01): midnight CDT at 05:00 UTC", () => {
    // Fall-back happens at 02:00 local; midnight is still CDT (UTC-5),
    // so puzzle 2026-10-31 ends at 2026-11-01 05:00 UTC.
    expect(puzzleEndUtcSecs("2026-10-31", "America/Chicago")).toBe(
      utcSec(2026, 11, 1, 5),
    );
  });

  it("null tz falls back to UTC-12 (most conservative)", () => {
    // UTC-12 midnight of (puzzleDay + 1) = UTC of (puzzleDay+1) noon.
    expect(puzzleEndUtcSecs("2026-05-26", null)).toBe(utcSec(2026, 5, 27, 12));
  });

  it("undefined tz falls back to UTC-12", () => {
    expect(puzzleEndUtcSecs("2026-05-26", undefined)).toBe(utcSec(2026, 5, 27, 12));
  });

  it("invalid IANA name falls back to UTC-12", () => {
    expect(puzzleEndUtcSecs("2026-05-26", "Not/A_Real_Zone")).toBe(
      utcSec(2026, 5, 27, 12),
    );
  });

  it("malformed puzzleId returns +Infinity (gate stays closed)", () => {
    expect(puzzleEndUtcSecs("not-a-date", "UTC")).toBe(Number.POSITIVE_INFINITY);
  });
});

// ─── pickAndLogDaily (smooth recency suppression × frequency) ─────────

// Pure in-memory fake of PickLogDeps. Mirrors the real DB shape but
// lives in two Maps so the picker is testable without touching SQLite.
function makeFakeLog(seedRows: Array<{ dayIndex: number; talentId: string }> = []): {
  deps: PickLogDeps;
  entries: Map<number, string>; // dayIndex → talentId
  inserts: number;
} {
  const entries = new Map<number, string>();
  for (const r of seedRows) entries.set(r.dayIndex, r.talentId);
  let inserts = 0;
  const deps: PickLogDeps = {
    getEntry(dayIndex) {
      return entries.get(dayIndex) ?? null;
    },
    getLastPicked(dayIndex) {
      const m = new Map<string, number>();
      for (const [d, id] of entries) {
        if (d < dayIndex && d > (m.get(id) ?? Number.NEGATIVE_INFINITY)) m.set(id, d);
      }
      return m;
    },
    getCounts() {
      const m = new Map<string, number>();
      for (const id of entries.values()) m.set(id, (m.get(id) ?? 0) + 1);
      return m;
    },
    insert(dayIndex, talentId) {
      if (entries.has(dayIndex)) return false;
      entries.set(dayIndex, talentId);
      inserts++;
      return true;
    },
  };
  return {
    deps,
    entries,
    get inserts() {
      return inserts;
    },
  } as { deps: PickLogDeps; entries: Map<number, string>; inserts: number };
}

describe("recencyWeight / pickWeight", () => {
  it("power-ramps from ~0 to 1 over the horizon", () => {
    expect(recencyWeight(Number.POSITIVE_INFINITY)).toBe(1); // never picked
    expect(recencyWeight(0)).toBe(0);
    expect(recencyWeight(1)).toBeCloseTo((1 / RECENCY_HORIZON_DAYS) ** RECENCY_EXPONENT, 10);
    expect(recencyWeight(RECENCY_HORIZON_DAYS)).toBe(1);
    expect(recencyWeight(RECENCY_HORIZON_DAYS * 5)).toBe(1);
    // Monotonic along the ramp.
    expect(recencyWeight(3)).toBeGreaterThan(recencyWeight(1));
    expect(recencyWeight(14)).toBeGreaterThan(recencyWeight(7));
  });

  it("divides by (count + 1) for frequency evening", () => {
    expect(pickWeight(Number.POSITIVE_INFINITY, 0)).toBe(1);
    expect(pickWeight(Number.POSITIVE_INFINITY, 1)).toBe(0.5);
    expect(pickWeight(Number.POSITIVE_INFINITY, 2)).toBeCloseTo(1 / 3, 10);
    // Yesterday's pick is millions of times less likely than a fresh talent.
    expect(pickWeight(1, 0)).toBeLessThan(pickWeight(Number.POSITIVE_INFINITY, 0) / 1_000_000);
  });
});

describe("weightedPick", () => {
  it("with all-equal weights picks each index roughly equally", () => {
    // Burn a few RNG draws and assert every bucket appears.
    const counts = [0, 0, 0, 0];
    let s = 42;
    const rng = (): number => {
      // Tiny linear-congruential — independent of mulberry32 so this
      // test doesn't depend on internals.
      s = (1103515245 * s + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
    for (let i = 0; i < 4000; i++) counts[weightedPick([1, 1, 1, 1], rng)]!++;
    for (const c of counts) expect(c).toBeGreaterThan(800); // ~25% each, generous floor
  });

  it("biases toward higher weights", () => {
    let s = 7;
    const rng = (): number => {
      s = (1664525 * s + 1013904223) >>> 0;
      return s / 0x100000000;
    };
    const counts = [0, 0];
    // weight A = 4, B = 1 → A wins ~80% of the time.
    for (let i = 0; i < 1000; i++) counts[weightedPick([4, 1], rng)]!++;
    expect(counts[0]!).toBeGreaterThan(700);
    expect(counts[1]!).toBeLessThan(300);
  });
});

describe("pickAndLogDaily", () => {
  const pool = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j",
    "k", "l", "m", "n", "o", "p", "q", "r", "s", "t",
    "u", "v", "w", "x", "y", "z", "aa", "bb", "cc", "dd",
    "ee", "ff", "gg", "hh", "ii", "jj"].map(t);

  it("returns null for an empty pool", () => {
    const fake = makeFakeLog();
    expect(pickAndLogDaily([], 100, fake.deps)).toBeNull();
  });

  it("is idempotent — re-calling for the same day returns the logged talent and doesn't re-insert", () => {
    const fake = makeFakeLog();
    const first = pickAndLogDaily(pool, 100, fake.deps);
    expect(first).not.toBeNull();
    const insertsAfterFirst = fake.inserts;
    const second = pickAndLogDaily(pool, 100, fake.deps);
    expect(second?.id).toBe(first?.id);
    // No second insert.
    expect(fake.inserts).toBe(insertsAfterFirst);
  });

  it("smoothly suppresses recent picks — no same-week repeats in a long run", () => {
    // Play 120 consecutive days from an empty log. With the power ramp,
    // a repeat within 7 days of the previous pick carries ≤ (7/21)⁵ ≈ 0.4%
    // weight against ~30+ fresh-weight alternatives, so gaps that small
    // should never occur. Deterministic (seeded per day).
    const fake = makeFakeLog();
    const lastSeen = new Map<string, number>();
    let minGap = Number.POSITIVE_INFINITY;
    for (let d = 100; d < 220; d++) {
      const pick = pickAndLogDaily(pool, d, fake.deps);
      expect(pick).not.toBeNull();
      const prev = lastSeen.get(pick!.id);
      if (prev !== undefined) minGap = Math.min(minGap, d - prev);
      lastSeen.set(pick!.id, d);
    }
    expect(minGap).toBeGreaterThan(7);
  });

  it("allows repeats eventually — nothing is hard-forbidden", () => {
    // Seed "a" picked long ago; over a long run "a" must appear again
    // (the old 30-day window also allowed this, but here there's no
    // cliff — eligibility ramps smoothly).
    const fake = makeFakeLog([{ dayIndex: 0, talentId: "a" }]);
    let seenA = false;
    for (let d = 100; d < 400 && !seenA; d++) {
      if (pickAndLogDaily(pool, d, fake.deps)?.id === "a") seenA = true;
    }
    expect(seenA).toBe(true);
  });

  it("is deterministic — same log state + dayIndex → same pick", () => {
    const fakeA = makeFakeLog();
    const fakeB = makeFakeLog();
    expect(pickAndLogDaily(pool, 12345, fakeA.deps)?.id).toBe(
      pickAndLogDaily(pool, 12345, fakeB.deps)?.id,
    );
  });

  it("biases picks toward less-frequently-picked talents", () => {
    // Heavily seed talents a..d with counts 100 each, and e..jj with 0
    // (never picked). Pick across a long horizon and assert the
    // never-picked group dominates. We pick across many WIDE-APART
    // dayIndexes (with no recent-window collisions to muddy the count)
    // and reset the recent set between draws so the weighting alone
    // decides the outcome.
    const heavy = ["a", "b", "c", "d"];
    const seeded: Array<{ dayIndex: number; talentId: string }> = [];
    let sd = -10_000;
    for (const id of heavy) {
      for (let i = 0; i < 100; i++) {
        seeded.push({ dayIndex: sd++, talentId: id }); // way in the past, outside any window
      }
    }
    const fake = makeFakeLog(seeded);
    const heavySet = new Set(heavy);
    let heavyHits = 0;
    let lightHits = 0;
    // 200 trials, each 50 days apart so the just-picked talent rarely
    // collides into the next trial's recent window.
    for (let i = 0; i < 200; i++) {
      const day = 100_000 + i * 50;
      const pick = pickAndLogDaily(pool, day, fake.deps);
      if (!pick) continue;
      if (heavySet.has(pick.id)) heavyHits++;
      else lightHits++;
    }
    // With weights ~1/101 for heavy vs 1.0 for light, the light group
    // (32 of 36 pool members) should crush the heavy four. A relaxed
    // floor of 10× ensures the test is stable under any RNG seed drift.
    expect(lightHits).toBeGreaterThan(heavyHits * 10);
  });

  it("small pools keep working — weights favor the least-recently-seen", () => {
    // 4-talent pool, all picked within the last 4 days. No member is
    // forbidden (no hard window any more) but the oldest pick ("a",
    // 4 days ago) carries the highest weight: (4/21)⁵ vs (1/21)⁵ for
    // yesterday's "d". The picker must return SOMETHING, and across many
    // such days the older picks should dominate. Here we just assert
    // totality + that yesterday's pick isn't chosen (weight 1024× smaller).
    const tinyPool = ["a", "b", "c", "d"].map(t);
    const fake = makeFakeLog([
      { dayIndex: 96, talentId: "a" },
      { dayIndex: 97, talentId: "b" },
      { dayIndex: 98, talentId: "c" },
      { dayIndex: 99, talentId: "d" },
    ]);
    const pick = pickAndLogDaily(tinyPool, 100, fake.deps);
    expect(pick).not.toBeNull();
    expect(pick?.id).not.toBe("d");
  });

  it("degenerate all-zero weights fall back to a uniform seeded draw", () => {
    // Force daysSince = 0 for every member via a custom getLastPicked.
    const tinyPool = ["a", "b"].map(t);
    const deps: PickLogDeps = {
      getEntry: () => null,
      getLastPicked: (dayIndex) => new Map(tinyPool.map((x) => [x.id, dayIndex])),
      getCounts: () => new Map(),
      insert: () => true,
    };
    const pick = pickAndLogDaily(tinyPool, 100, deps);
    expect(pick).not.toBeNull();
  });
});
