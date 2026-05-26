import type {
  AttrCell,
  GuessDiff,
  HeightBucket,
  Month,
  Talent,
} from "@holodle/shared";

// Calendar order. Used to give birth-month misses a direction (↑ when the
// target falls later in the year than the guess, ↓ when earlier). Wrap-around
// isn't modeled — Jan and Dec are 11 months apart, not 1.
const MONTH_ORDER: Month[] = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const MONTH_INDEX: Record<Month, number> = Object.fromEntries(
  MONTH_ORDER.map((m, i) => [m, i]),
) as Record<Month, number>;

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
// joined for display so the pill shows "Gen 1 / GAMERS" for Fubuki rather
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

function birthMonthCell(guess: Month, target: Month): AttrCell<Month> {
  if (guess === target) return { value: guess, state: "equal" };
  // Linear (non-wrapping) comparison by calendar order — Jan < Feb < ... < Dec.
  // "higher" means the answer's birthday falls later in the year.
  return {
    value: guess,
    state: MONTH_INDEX[target] > MONTH_INDEX[guess] ? "higher" : "lower",
  };
}

export function compareGuess(guess: Talent, target: Talent): GuessDiff {
  return {
    talentId: guess.id,
    generation: multiCell(guess.generation, target.generation),
    branch: exactCell(guess.branch, guess.branch === target.branch),
    penlightColor: penlightColorCell(guess.penlightColor, target.penlightColor),
    archetype: multiCell(guess.archetype, target.archetype),
    height: exactCell(heightBucket(guess.heightCm), heightBucket(guess.heightCm) === heightBucket(target.heightCm)),
    birthMonth: birthMonthCell(guess.birthMonth, target.birthMonth),
  };
}
