import type { Talent } from "@holodle/shared";
import { compareGuess } from "./compare.js";
import { FEEDBACK_ATTRS, feedbackKey } from "./feedback.js";

// ─── Best Guess Explorer engine ─────────────────────────────────────────
//
// Powers the admin panel's "Best Guess Explorer" (optimal play, computed
// from the roster) and the "Attribute Usefulness" chart. Both treat the
// daily answer as uniformly random over the active pool — the real picker
// is weighted, but uniform is the right prior for strategy analysis.

export interface BestGuessSuggestion {
  talentId: string;
  // Average number of candidates left if you make this guess (lower = better).
  expectedRemaining: number;
  // Largest single feedback bucket — the unluckiest case.
  worstCase: number;
  // How many distinct feedback patterns this guess can produce.
  partitions: number;
  // True when this guess is itself still a possible answer (a "free shot").
  isCandidate: boolean;
}

export interface BestGuessResult {
  // Active talents consistent with the given guess + feedback. For the
  // start-of-game case this is the whole active pool.
  candidates: string[];
  suggestions: BestGuessSuggestion[];
}

// Filters the active pool down to the answers consistent with `guess`
// having returned `pattern` (a six-char E/P/X key in FEEDBACK_ATTRS order).
function consistentCandidates(guess: Talent, pattern: string, pool: Talent[]): Talent[] {
  return pool.filter((t) => feedbackKey(compareGuess(guess, t)) === pattern);
}

// Ranks every guessable talent by how well it splits `candidates`:
// primary key expected remaining (sum of bucket² / n), then prefer guesses
// that are themselves candidates (they can win outright), then more
// partitions. `allTalents` includes inactive talents — they're valid probes.
function rankGuesses(
  candidates: Talent[],
  allTalents: Talent[],
  topN: number,
): BestGuessSuggestion[] {
  const n = candidates.length;
  if (n === 0) return [];
  const candidateIds = new Set(candidates.map((c) => c.id));
  const scored: BestGuessSuggestion[] = allTalents.map((g) => {
    const buckets = new Map<string, number>();
    for (const c of candidates) {
      const key = feedbackKey(compareGuess(g, c));
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    let sumSq = 0;
    let worst = 0;
    for (const size of buckets.values()) {
      sumSq += size * size;
      if (size > worst) worst = size;
    }
    return {
      talentId: g.id,
      expectedRemaining: sumSq / n,
      worstCase: worst,
      partitions: buckets.size,
      isCandidate: candidateIds.has(g.id),
    };
  });
  scored.sort(
    (a, b) =>
      a.expectedRemaining - b.expectedRemaining ||
      Number(b.isCandidate) - Number(a.isCandidate) ||
      b.partitions - a.partitions,
  );
  return scored.slice(0, topN);
}

// guessId === null means "start of game": candidates are the full active
// pool and the ranking is the best-opener list. Throws on unknown guess ids
// (the route validates first, this is a backstop).
export function exploreBestGuess(
  guessId: string | null,
  pattern: string,
  registry: { all: Talent[]; activePool: Talent[]; byId: Map<string, Talent> },
  topN = 10,
): BestGuessResult {
  let candidates: Talent[];
  if (guessId === null) {
    candidates = registry.activePool;
  } else {
    const guess = registry.byId.get(guessId);
    if (!guess) throw new Error(`Unknown talent id: ${guessId}`);
    candidates = consistentCandidates(guess, pattern, registry.activePool);
  }
  return {
    candidates: candidates.map((c) => c.id),
    suggestions: rankGuesses(candidates, registry.all, topN),
  };
}

// Average information (bits) each attribute's feedback provides per guess:
// for every guessable talent, partition the active pool by that attribute's
// cell state (equal/partial/wrong) and take the entropy of the split, then
// average across guesses. 0 bits = the column never separates anything;
// higher = it narrows the field more on a typical guess. Binary columns cap
// at 1 bit; archetype (the only one with partials) caps at log2(3) ≈ 1.58.
export function attributeUsefulness(
  allTalents: Talent[],
  activePool: Talent[],
): Record<string, number> {
  const out: Record<string, number> = {};
  const n = activePool.length;
  if (n === 0 || allTalents.length === 0) {
    for (const attr of FEEDBACK_ATTRS) out[String(attr)] = 0;
    return out;
  }
  const sums = new Map<string, number>(FEEDBACK_ATTRS.map((a) => [String(a), 0]));
  for (const g of allTalents) {
    const stateCounts = new Map<string, Record<string, number>>(
      FEEDBACK_ATTRS.map((a) => [String(a), {}]),
    );
    for (const t of activePool) {
      const diff = compareGuess(g, t);
      for (const attr of FEEDBACK_ATTRS) {
        const key = String(attr);
        const counts = stateCounts.get(key);
        const st = diff[attr]?.state ?? "wrong";
        if (counts) counts[st] = (counts[st] ?? 0) + 1;
      }
    }
    for (const attr of FEEDBACK_ATTRS) {
      const key = String(attr);
      const counts = stateCounts.get(key);
      if (!counts) continue;
      let entropy = 0;
      for (const c of Object.values(counts)) {
        if (c === 0) continue;
        const p = c / n;
        entropy -= p * Math.log2(p);
      }
      sums.set(key, (sums.get(key) ?? 0) + entropy);
    }
  }
  for (const [key, sum] of sums) out[key] = sum / allTalents.length;
  return out;
}
