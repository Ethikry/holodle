import type {
  AttrCell,
  Branch,
  GuessDiff,
  HeightBucket,
  Month,
  Talent,
} from "@holodle/shared";

// Height bucket cutoffs are: ≤150 = Smol, 151–160 = Med, >160 = Tall.
// Important: 150 cm itself buckets to Smol. Any change to these boundaries
// must be reflected in BUCKET_LABEL in GuessRow.tsx and the README schema
// docs.
export function heightBucket(cm: number): HeightBucket {
  if (cm <= 150) return "Smol";
  if (cm > 160) return "Tall";
  return "Med";
}

function exactCell<V>(value: V, equal: boolean): AttrCell<V> {
  return { value, state: equal ? "equal" : "wrong" };
}

function asList(v: string | string[]): string[] {
  return Array.isArray(v) ? v : [v];
}

// Multi-valued exact match: matches when the guess's value set intersects
// the target's value set. The cell value carries the guess's value(s),
// joined for display so the pill shows "Bird / Demon" for Nerissa rather
// than dropping one of the labels.
function multiCell(guess: string | string[], target: string | string[]): AttrCell<string> {
  const guessSet = asList(guess);
  const targetSet = new Set(asList(target));
  const equal = guessSet.some((g) => targetSet.has(g));
  return { value: guessSet.join(" / "), state: equal ? "equal" : "wrong" };
}

function penlightColorCell(
  guess: string | null,
  target: string | null,
): AttrCell<string> {
  // null/None means "no assigned color" — two such talents only match each
  // other; a None guess against a colored target (or vice versa) is wrong.
  const guessLabel = guess ?? "None";
  const equal = (guess ?? "None") === (target ?? "None");
  return { value: guessLabel, state: equal ? "equal" : "wrong" };
}

// Generation display labels. Maps the canonical generation string stored
// in talent_data.json to the formatted label shown to users. Un-numbered
// gens get a synthetic gen number for parity with the JP Gen 0..Gen 5
// scheme; the original group name lives in the parenthetical so a quick
// "EN Gen 2 (Promise)" tells players exactly which cohort matched.
// Council ⇒ Promise — Council members who stayed migrated to the Promise
// rebrand after Sana's graduation, so we treat them as one cohort for
// matching too (see GEN_NORMALIZE below).
const GEN_DISPLAY: Record<string, string> = {
  "holoX": "Gen 6 (holoX)",
  Myth: "Gen 1 (Myth)",
  Council: "Gen 2 (Promise)",
  Promise: "Gen 2 (Promise)",
  Advent: "Gen 3 (Advent)",
  Justice: "Gen 4 (Justice)",
  ReGLOSS: "Gen 1 (ReGLOSS)",
  "FLOW GLOW": "Gen 2 (FLOWGLOW)",
};

function displayGen(gen: string): string {
  return GEN_DISPLAY[gen] ?? gen;
}

// For matching, Council and Promise count as the same cohort. Anywhere
// we compare generation values, normalize through this map first.
const GEN_NORMALIZE: Record<string, string> = {
  Council: "Promise",
};

function normalizeGen(gen: string): string {
  return GEN_NORMALIZE[gen] ?? gen;
}

// Formatted combined value: "JP Gen 1", "EN Gen 1 (Myth)", or for
// multi-group talents "JP Gen 1 / GAMERS" — branch shown once, gen
// labels joined with " / ".
export function displayGroup(branch: Branch, generation: string | string[]): string {
  const gens = asList(generation).map(displayGen);
  return `${branch} ${gens.join(" / ")}`;
}

// Combined branch + generation cell. Three states:
//   - "equal":   branch AND any generation match
//   - "partial": exactly one of (branch, generation) matches
//   - "wrong":   neither matches
function groupCell(guess: Talent, target: Talent): AttrCell<string> {
  const branchMatch = guess.branch === target.branch;
  const guessGens = asList(guess.generation).map(normalizeGen);
  const targetGens = new Set(asList(target.generation).map(normalizeGen));
  const genMatch = guessGens.some((g) => targetGens.has(g));
  const matches = (branchMatch ? 1 : 0) + (genMatch ? 1 : 0);
  let state: "equal" | "partial" | "wrong";
  if (matches === 2) state = "equal";
  else if (matches === 1) state = "partial";
  else state = "wrong";
  return { value: displayGroup(guess.branch, guess.generation), state };
}

function birthMonthCell(guess: Month, target: Month): AttrCell<Month> {
  // Birth month is now equal-or-wrong only (no higher/lower arrows).
  return { value: guess, state: guess === target ? "equal" : "wrong" };
}

export function compareGuess(guess: Talent, target: Talent): GuessDiff {
  return {
    talentId: guess.id,
    group: groupCell(guess, target),
    penlightColor: penlightColorCell(guess.penlightColor, target.penlightColor),
    archetype: multiCell(guess.archetype, target.archetype),
    height: exactCell(heightBucket(guess.heightCm), heightBucket(guess.heightCm) === heightBucket(target.heightCm)),
    birthMonth: birthMonthCell(guess.birthMonth, target.birthMonth),
  };
}
