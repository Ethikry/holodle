import type {
  AttrCell,
  GuessDiff,
  HeightBucket,
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

function debutYearCell(guess: number, target: number): AttrCell<number> {
  if (guess === target) return { value: guess, state: "equal" };
  // No "near" state; off-by-one is just a miss with a directional arrow.
  return { value: guess, state: target > guess ? "higher" : "lower" };
}

export function compareGuess(guess: Talent, target: Talent): GuessDiff {
  return {
    talentId: guess.id,
    generation: exactCell(guess.generation, guess.generation === target.generation),
    branch: exactCell(guess.branch, guess.branch === target.branch),
    debutYear: debutYearCell(guess.debutYear, target.debutYear),
    archetype: exactCell(guess.archetype, guess.archetype === target.archetype),
    height: exactCell(heightBucket(guess.heightCm), heightBucket(guess.heightCm) === heightBucket(target.heightCm)),
    birthMonth: exactCell(guess.birthMonth, guess.birthMonth === target.birthMonth),
  };
}
