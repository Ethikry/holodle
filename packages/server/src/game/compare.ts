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
// in talent_data.json to the formatted label shown to users. Numbered
// JP gens render as-is ("Gen 2"); un-numbered named cohorts render as
// "Gen N (CohortName)" so the player sees both the gen number and the
// branded label. Council/Promise both render as "Gen 2 (Promise)" —
// they're the same cohort (Council members migrated to Promise).
const GEN_DISPLAY: Record<string, string> = {
  holoX: "Gen 6",
  Myth: "Gen 1",
  Council: "Gen 2",
  Promise: "Gen 2",
  "Project: HOPE": "Gen 2",
  Advent: "Gen 3",
  Justice: "Gen 4",
  ReGLOSS: "Gen 1",
  "FLOW GLOW": "Gen 2",
};

function displayGen(gen: string): string {
  return GEN_DISPLAY[gen] ?? gen;
}

// Generation normalisation for matching. Every named cohort collapses
// to its numeric gen tag so cross-branch comparisons agree by what
// the player SEES on the chip (e.g. Aqua's "Gen 2" matches Fauna's
// "Gen 2 (Promise)"). GAMERS stays unmapped — it's the lone cohort
// without a gen number, so it only matches itself.
const GEN_NORMALIZE: Record<string, string> = {
  Myth: "Gen 1",
  Council: "Gen 2",
  Promise: "Gen 2",
  "Project: HOPE": "Gen 2",
  Advent: "Gen 3",
  Justice: "Gen 4",
  ReGLOSS: "Gen 1",
  "FLOW GLOW": "Gen 2",
  holoX: "Gen 6",
};

function normalizeGen(gen: string): string {
  return GEN_NORMALIZE[gen] ?? gen;
}

// Cell value for the Generation column. Branch is intentionally NOT
// included — generation matches across branches now, so showing the
// branch alongside would suggest it's part of the comparison when it
// isn't. Multi-group talents (e.g. Fubuki: ["Gen 1", "GAMERS"]) join
// their gen labels with " / ".
//
// The exported name stays `displayGroup` so callers don't need to
// rename, but the Branch parameter is now ignored.
export function displayGroup(_branch: Branch, generation: string | string[]): string {
  return asList(generation).map(displayGen).join(" / ");
}

// Generation cell. Two states only:
//   - "equal":  any (normalised) generation overlaps the target's
//   - "wrong":  no overlap
// Branch is ignored — Aqua (JP Gen 2) matches Fauna (EN Promise/Gen 2).
function groupCell(guess: Talent, target: Talent): AttrCell<string> {
  const guessGens = asList(guess.generation).map(normalizeGen);
  const targetGens = new Set(asList(target.generation).map(normalizeGen));
  const match = guessGens.some((g) => targetGens.has(g));
  return {
    value: displayGroup(guess.branch, guess.generation),
    state: match ? "equal" : "wrong",
  };
}

function birthMonthCell(guess: Month, target: Month): AttrCell<Month> {
  // Birth month is now equal-or-wrong only (no higher/lower arrows).
  return { value: guess, state: guess === target ? "equal" : "wrong" };
}

export function compareGuess(guess: Talent, target: Talent): GuessDiff {
  return {
    talentId: guess.id,
    branch: exactCell<Branch>(guess.branch, guess.branch === target.branch),
    group: groupCell(guess, target),
    penlightColor: penlightColorCell(guess.penlightColor, target.penlightColor),
    archetype: multiCell(guess.archetype, target.archetype),
    height: exactCell(heightBucket(guess.heightCm), heightBucket(guess.heightCm) === heightBucket(target.heightCm)),
    birthMonth: birthMonthCell(guess.birthMonth, target.birthMonth),
  };
}
