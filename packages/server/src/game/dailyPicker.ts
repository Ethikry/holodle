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

// Sequential puzzle number anchored at PUZZLE_NUMBER_EPOCH_MS (= UTC midnight
// on the launch date for this counter). Today UTC = 1, tomorrow = 2, etc.
// Display-only — the canonical key is still puzzleIdFor (YYYY-MM-DD), and we
// avoid storing this number anywhere so changing the epoch doesn't corrupt
// existing rows. Negative results clamp to 1 so retroactive embeds for
// pre-epoch dates don't show "0" or "-3".
//
// 2026-05-20 was chosen as day #1: that's the UTC date when the image-embed
// rewrite first landed in production and we want puzzles numbered from there.
const PUZZLE_NUMBER_EPOCH_MS = Date.UTC(2026, 4, 20);

export function displayPuzzleNumberFor(nowMs: number = Date.now()): number {
  const today = dayIndexFor(nowMs, "UTC");
  const epoch = dayIndexFor(PUZZLE_NUMBER_EPOCH_MS, "UTC");
  return Math.max(1, today - epoch + 1);
}

// Same conversion but driven by a puzzleId string (YYYY-MM-DD UTC). Used when
// the channel embed has the puzzle_id but no surrounding `nowMs`.
export function displayPuzzleNumberForPuzzleId(puzzleId: string): number {
  const parts = puzzleId.split("-");
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (!y || !m || !d) return 1;
  const ms = Date.UTC(Number.parseInt(y, 10), Number.parseInt(m, 10) - 1, Number.parseInt(d, 10));
  if (!Number.isFinite(ms)) return 1;
  return displayPuzzleNumberFor(ms);
}

// Parse YYYY-MM-DD back into a dayIndex. Inverse of puzzleIdFor — useful
// when we have a puzzle_id string from the DB and want to look up a
// user_day row keyed by dayIndex, without having to re-derive the source
// timezone (puzzleIdFor's tz only affects the YMD; dayIndex is purely a
// function of the YMD).
export function dayIndexForPuzzleId(puzzleId: string): number {
  const parts = puzzleId.split("-");
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (!y || !m || !d) return 0;
  const ms = Date.UTC(Number.parseInt(y, 10), Number.parseInt(m, 10) - 1, Number.parseInt(d, 10));
  if (!Number.isFinite(ms)) return 0;
  return Math.floor((ms - EPOCH_UTC_MS) / 86_400_000);
}

// UTC milliseconds equivalent of `atUtcMs` re-expressed on the wall clock
// of `tz`. Returns the difference (tzClock − UTC) in ms. Positive for
// timezones east of UTC, negative for west. Uses the existing en-CA
// numeric/2-digit pattern so we can parse the parts without locale
// guessing. DST is automatic because we re-derive offset at the supplied
// instant.
function tzOffsetMs(tz: string, atUtcMs: number): number {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = f.formatToParts(new Date(atUtcMs));
  const get = (t: string): number =>
    Number.parseInt(parts.find((p) => p.type === t)?.value ?? "0", 10);
  // Date.UTC of the locally-rendered Y/M/D h/m/s → the UTC instant a clock
  // showing those wall-time digits in UTC would represent. The difference
  // from the supplied UTC instant IS the tz offset.
  let hour = get("hour");
  // Intl can emit hour=24 at midnight under some locales; normalise to 00
  // on the next day so the math is consistent.
  if (hour === 24) hour = 0;
  const localAsUtcMs = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    hour,
    get("minute"),
    get("second"),
  );
  return localAsUtcMs - atUtcMs;
}

// Returns the UTC second at which `puzzleId` (a YYYY-MM-DD string) ENDS in
// the supplied tz — i.e. local midnight at the start of (puzzleDay + 1) in
// that tz. Drives the recap-safety gate: a puzzle for which any participant
// hasn't yet crossed this moment is still "today" for that participant and
// the recap is premature.
//
// `tz` of null/undefined or any invalid IANA name falls back to UTC-12,
// the most conservative ceiling — guarantees nobody is recapped mid-day
// even on a hypothetical UTC-12 calendar. DST transitions are handled by
// iterating once: the offset at our initial estimate may differ from the
// offset at the true midnight (e.g. when DST falls back across midnight),
// so we recompute at the corrected instant.
export function puzzleEndUtcSecs(puzzleId: string, tz: string | null | undefined): number {
  const parts = puzzleId.split("-");
  const y = Number.parseInt(parts[0] ?? "", 10);
  const m = Number.parseInt(parts[1] ?? "", 10);
  const d = Number.parseInt(parts[2] ?? "", 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    // Malformed puzzleId — fall through to a "never safe" answer so the
    // gate keeps the recap pending rather than firing prematurely.
    return Number.POSITIVE_INFINITY;
  }
  // Midnight UTC at the start of (puzzleDay + 1). The reference point we
  // shift by tz offset.
  const nextDayUtcMs = Date.UTC(y, m - 1, d + 1);

  // tz was null/undefined or didn't survive safeTz validation → use the
  // UTC-12 ceiling (12h west of UTC, the latest plausible local midnight).
  const isUnknown = !tz || (safeTz(tz) === "UTC" && tz !== "UTC");
  if (isUnknown) {
    return Math.floor((nextDayUtcMs + 12 * 3600 * 1000) / 1000);
  }
  const safeTzName = safeTz(tz);

  // First pass: estimate the offset at the next-day UTC midnight itself.
  // utcInstant + tzOffsetAt(utcInstant) ≈ localMidnight, so
  // utcInstant ≈ localMidnight − tzOffset.
  const firstOffset = tzOffsetMs(safeTzName, nextDayUtcMs);
  let utcInstant = nextDayUtcMs - firstOffset;
  // Second pass: re-estimate offset at the corrected instant to absorb DST
  // crossings (rare; on a fall-back, offset shifts by 1h precisely at
  // local 02:00, which is well past our target midnight, so usually no-op).
  const secondOffset = tzOffsetMs(safeTzName, utcInstant);
  if (secondOffset !== firstOffset) {
    utcInstant = nextDayUtcMs - secondOffset;
  }
  return Math.floor(utcInstant / 1000);
}

// "YYYY-MM-DD" → "YYYY-MM-DD" the previous calendar day. Pure date math
// (no tz). Used by computeChannelStreak to walk backward.
export function prevPuzzleId(puzzleId: string): string {
  const parts = puzzleId.split("-");
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (!y || !m || !d) return puzzleId;
  const ms = Date.UTC(Number.parseInt(y, 10), Number.parseInt(m, 10) - 1, Number.parseInt(d, 10));
  if (!Number.isFinite(ms)) return puzzleId;
  return ymdFormatter("UTC").format(new Date(ms - 86_400_000));
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

// Rolling no-repeat window. Any talent that was the answer for one of
// the previous `NO_REPEAT_WINDOW` dayIndexes is excluded from today's
// candidate set. Pure / deterministic — no DB needed since each day's
// answer is a function of the dayIndex alone.
export const NO_REPEAT_WINDOW = 30;

// Memo across all pools — we key by the pool reference (the same way
// shuffleOnce does) plus the integer day. The memo grows linearly with
// the largest dayIndex queried; in practice that's bounded by how often
// pickForDayIndex is called.
const dayPickMemo = new WeakMap<Talent[], Map<number, Talent | null>>();

function getPoolMemo(pool: Talent[]): Map<number, Talent | null> {
  let m = dayPickMemo.get(pool);
  if (!m) {
    m = new Map();
    dayPickMemo.set(pool, m);
  }
  return m;
}

// Pick the talent for the given dayIndex while honouring the 30-day
// no-repeat rule. The algorithm walks the seeded-shuffle list starting
// at `idx mod N` and advances past any talent that was the answer for
// any of the previous NO_REPEAT_WINDOW dayIndexes. With ~64 active
// talents and a 30-day exclusion window, the walk is always short.
//
// The function recurses into the prior days' picks but memoizes each
// result, so total work is O(NO_REPEAT_WINDOW) per uncached day. Server
// restarts simply repopulate the memo on demand; the function is pure
// so the answer for a given dayIndex never changes.
export function pickByIndex(pool: Talent[], idx: number): Talent | null {
  if (pool.length === 0) return null;
  const memo = getPoolMemo(pool);
  if (memo.has(idx)) return memo.get(idx) ?? null;

  // Recent-window lookup is recursive but memoized; build the set of
  // recently-picked talent ids first.
  const recent = new Set<string>();
  for (let d = idx - 1; d >= idx - NO_REPEAT_WINDOW && d >= 0; d--) {
    const prior = pickByIndex(pool, d);
    if (prior) recent.add(prior.id);
  }

  const shuffled = shuffleOnce(pool);
  const start = ((idx % shuffled.length) + shuffled.length) % shuffled.length;
  let chosen: Talent | null = null;
  for (let step = 0; step < shuffled.length; step++) {
    const candidate = shuffled[(start + step) % shuffled.length];
    if (candidate && !recent.has(candidate.id)) {
      chosen = candidate;
      break;
    }
  }
  // Fallback: NO_REPEAT_WINDOW ≥ pool.length means every talent has been
  // used recently. Returning the canonical pick keeps the picker
  // total-functional; in practice this branch is unreachable for any
  // pool larger than NO_REPEAT_WINDOW.
  if (!chosen) {
    chosen = shuffled[start] ?? null;
  }
  memo.set(idx, chosen);
  return chosen;
}

// Per-user puzzle picker. `tz` selects whose local calendar to bucket by.
export function pickDaily(
  pool: Talent[],
  nowMs: number = Date.now(),
  tz: string = "UTC",
): Talent | null {
  return pickByIndex(pool, dayIndexFor(nowMs, tz));
}

// ─── Weighted-random picker backed by daily_pick_log ──────────────────
//
// `pickByIndex` above is a pure shuffle-walk and remains in use for the
// /endless test command. For normal play we want:
//
//   1. Idempotency per dayIndex (so /api/daily and /api/guess agree).
//   2. The same 30-day no-repeat exclusion.
//   3. Weighted random selection biased toward LESS-frequently-picked
//      talents — newly added catalog members (count 0) win most rolls
//      until their tally catches up; over the long run, picks even out.
//
// The picker takes a tiny `PickLogDeps` shape rather than a concrete
// better-sqlite3 handle so tests can inject a pure in-memory fake. The
// production wiring in routes/daily.ts + routes/guess.ts passes the
// real DB-backed helpers from db/client.ts.

export interface PickLogDeps {
  // Existing entry for this dayIndex, if any. Idempotency anchor.
  getEntry(dayIndex: number): string | null;
  // Ids picked within [dayIndex - window, dayIndex).
  getRecent(dayIndex: number, windowDays: number): Set<string>;
  // Most-recent N picks, newest first. Used by the small-pool fallback.
  getRecentOrdered(dayIndex: number, limit: number): Array<{ dayIndex: number; talentId: string }>;
  // talentId → all-time count of picks. Missing keys = 0.
  getCounts(): Map<string, number>;
  // INSERT OR IGNORE the chosen pick. Returns true if it wrote a row.
  insert(dayIndex: number, talentId: string): boolean;
}

// Compute weighted random index `i` such that `weights[i]` is more
// likely to win. Pure — given the same rng + same weights, returns the
// same index. Internal helper, exported only for the test suite.
export function weightedPick(weights: number[], rng: () => number): number {
  let total = 0;
  for (const w of weights) total += w;
  if (total <= 0) return 0;
  const r = rng() * total;
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i]!;
    if (r < acc) return i;
  }
  // Floating-point cushion: if rounding pushed `r` past `total`, just
  // return the last index.
  return weights.length - 1;
}

// Pick today's talent with the weighted-random algorithm and persist
// the result. Idempotent — if `deps.getEntry(dayIndex)` returns an id
// already in `pool`, that talent is returned and no insert happens.
//
// Algorithm:
//   1. If the log already has dayIndex, return that talent.
//   2. recent = the 30-day window of past picks.
//   3. eligible = pool filtered down by `recent`.
//   4. If eligible is empty (pool ≤ NO_REPEAT_WINDOW edge case), fall
//      back to the LEAST recently-picked member of the full pool.
//   5. weight[t] = 1 / (count[t.id] + 1); never-picked talents get 1.0,
//      picked once → 0.5, twice → 0.33 …
//   6. Draw weighted-random index seeded by dayIndex (so a given dayIndex
//      + log state always picks the same talent — same answer for both
//      /api/daily and /api/guess in the same day).
//   7. INSERT OR IGNORE into the log and return.
export function pickAndLogDaily(
  pool: Talent[],
  dayIndex: number,
  deps: PickLogDeps,
): Talent | null {
  if (pool.length === 0) return null;

  const existing = deps.getEntry(dayIndex);
  if (existing) {
    const found = pool.find((t) => t.id === existing);
    // If the pool was edited and the previously-recorded talent is gone,
    // fall through to a fresh pick rather than returning null. The log
    // row sticks around (a small bit of historical noise) but the day
    // still gets a valid answer.
    if (found) return found;
  }

  const recent = deps.getRecent(dayIndex, NO_REPEAT_WINDOW);
  const counts = deps.getCounts();

  let eligible = pool.filter((t) => !recent.has(t.id));

  // Small-pool fallback: every talent is in the recent window. Pick the
  // one that hasn't been seen the longest (= NOT in the most-recent
  // ordered list, or appears latest in it).
  if (eligible.length === 0) {
    const ordered = deps.getRecentOrdered(dayIndex, NO_REPEAT_WINDOW);
    // Build id → mostRecentDayIndex map; whichever pool member is missing
    // (impossible if pool ⊆ recent) or has the smallest dayIndex wins.
    const lastSeen = new Map<string, number>();
    for (const r of ordered) {
      if (!lastSeen.has(r.talentId)) lastSeen.set(r.talentId, r.dayIndex);
    }
    let bestIdx = 0;
    let bestSeen = Number.POSITIVE_INFINITY;
    for (let i = 0; i < pool.length; i++) {
      const seen = lastSeen.get(pool[i]!.id) ?? -Infinity;
      if (seen < bestSeen) {
        bestSeen = seen;
        bestIdx = i;
      }
    }
    eligible = [pool[bestIdx]!];
  }

  const weights = eligible.map((t) => 1 / ((counts.get(t.id) ?? 0) + 1));
  // Seed is dayIndex XOR a fixed constant so we don't reuse the shuffle
  // seed; the constant is committed and immutable.
  const rng = mulberry32((dayIndex ^ 0x9e3779b1) >>> 0);
  const pickIdx = weightedPick(weights, rng);
  const chosen = eligible[pickIdx] ?? eligible[0]!;

  deps.insert(dayIndex, chosen.id);
  return chosen;
}
