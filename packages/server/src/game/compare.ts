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

function debutYearCell(guess: number, target: number): AttrCell<number> {
  if (guess === target) return { value: guess, state: "equal" };
  // No "near" state; off-by-one is just a miss with a directional arrow.
  return { value: guess, state: target > guess ? "higher" : "lower" };
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
    generation: exactCell(guess.generation, guess.generation === target.generation),
    branch: exactCell(guess.branch, guess.branch === target.branch),
    debutYear: debutYearCell(guess.debutYear, target.debutYear),
    archetype: exactCell(guess.archetype, guess.archetype === target.archetype),
    height: exactCell(heightBucket(guess.heightCm), heightBucket(guess.heightCm) === heightBucket(target.heightCm)),
    birthMonth: birthMonthCell(guess.birthMonth, target.birthMonth),
  };
}
