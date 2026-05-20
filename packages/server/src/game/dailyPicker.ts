import type { Talent } from "@holodle/shared";

// EPOCH baseline is 2024-01-01 in UTC. dayIndex counts calendar days since
// that date, measured in the user's local timezone (so two users in
// different zones can be on different dayIndexes at the same wall-clock
// moment — that's the design).
export const EPOCH_UTC_MS = Date.UTC(2024, 0, 1);

// Committed fixed seed — do not change without explanation. Changing this
// reshuffles the daily order for every player retroactively.
const SHUFFLE_SEED = 0xc0ba1cafe;

// Cache of (timezone → YMD formatter) so we're not constructing a new
// Intl.DateTimeFormat on every request. Formatters are immutable + thread-safe.
const formatters = new Map<string, Intl.DateTimeFormat>();

function ymdFormatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    // "en-CA" lays out as YYYY-MM-DD so we can string-split without locale parsing.
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    formatters.set(tz, f);
  }
  return f;
}

// Parses an IANA tz with a try/catch on construction. Returns the validated
// timezone or "UTC" as a safe fallback. Used at the route boundary.
export function safeTz(tz: string | undefined): string {
  if (!tz) return "UTC";
  try {
    // Throws RangeError on an invalid zone.
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

// Calendar-aware dayIndex: format `nowMs` to YYYY-MM-DD in `tz`, parse the
// date back as a UTC midnight, then count whole days since EPOCH. DST-safe
// because we're working in date-only space, not time arithmetic.
export function dayIndexFor(nowMs: number = Date.now(), tz: string = "UTC"): number {
  const ymd = ymdFormatter(tz).format(new Date(nowMs)); // "2024-05-19"
  const [y, m, d] = ymd.split("-").map((s) => Number.parseInt(s, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    // Shouldn't happen with en-CA + numeric/2-digit, but fall back to UTC math.
    return Math.floor((nowMs - EPOCH_UTC_MS) / 86_400_000);
  }
  const localMidnightUtcMs = Date.UTC(y!, m! - 1, d!);
  return Math.floor((localMidnightUtcMs - EPOCH_UTC_MS) / 86_400_000);
}

// Human-readable puzzle id — same YYYY-MM-DD string we computed for the
// dayIndex. Used in embed titles and surfaced to the client.
export function puzzleIdFor(nowMs: number = Date.now(), tz: string = "UTC"): string {
  return ymdFormatter(tz).format(new Date(nowMs));
}

// Convenience: the dayIndex/puzzleId in America/Chicago. Used by the recap
// scheduler — never by per-user routes.
export function cstDayIndexFor(nowMs: number = Date.now()): number {
  return dayIndexFor(nowMs, "America/Chicago");
}

// Mulberry32: small, fast, deterministic PRNG.
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle<T>(items: T[], seed: number): T[] {
  const rng = mulberry32(seed);
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    // biome-ignore lint/style/noNonNullAssertion: bounded index
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const cache = new WeakMap<Talent[], Talent[]>();

function shuffleOnce(pool: Talent[]): Talent[] {
  const memo = cache.get(pool);
  if (memo) return memo;
  const shuffled = seededShuffle(pool, SHUFFLE_SEED);
  cache.set(pool, shuffled);
  return shuffled;
}

// Per-user puzzle picker. `tz` selects whose local calendar to bucket by.
export function pickDaily(
  pool: Talent[],
  nowMs: number = Date.now(),
  tz: string = "UTC",
): Talent | null {
  if (pool.length === 0) return null;
  const shuffled = shuffleOnce(pool);
  const i = ((dayIndexFor(nowMs, tz) % shuffled.length) + shuffled.length) % shuffled.length;
  // biome-ignore lint/style/noNonNullAssertion: i is bounded and pool is non-empty
  return shuffled[i]!;
}
