import type { Talent } from "@holodle/shared";

// 2024-01-01T00:00:00Z. Day 0 is this date.
export const EPOCH_UTC_MS = Date.UTC(2024, 0, 1);

// Committed fixed seed — do not change without explanation. Changing this
// reshuffles the daily order for every player retroactively.
const SHUFFLE_SEED = 0xc0ba1cafe; // arbitrary constant; "h0l0" was reserved for tests

export function dayIndexFor(nowMs: number = Date.now()): number {
  return Math.floor((nowMs - EPOCH_UTC_MS) / 86_400_000);
}

export function puzzleIdFor(nowMs: number = Date.now()): string {
  const d = new Date(nowMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
    // swap
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

export function pickDaily(pool: Talent[], nowMs: number = Date.now()): Talent | null {
  if (pool.length === 0) return null;
  const shuffled = shuffleOnce(pool);
  const i = ((dayIndexFor(nowMs) % shuffled.length) + shuffled.length) % shuffled.length;
  // biome-ignore lint/style/noNonNullAssertion: i is bounded and pool is non-empty
  return shuffled[i]!;
}
