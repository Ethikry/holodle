import type {
  AttrCell,
  GuessDiff,
  HeightBucket,
  Month,
  Talent,
} from "@holodle/shared";

const MONTHS: Month[] = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function heightBucket(cm: number): HeightBucket {
  if (cm < 150) return "Small";
  if (cm > 160) return "Tall";
  return "Med";
}

const BUCKET_ORDER: HeightBucket[] = ["Small", "Med", "Tall"];

function exactCell<V>(value: V, equal: boolean): AttrCell<V> {
  return { value, state: equal ? "equal" : "wrong" };
}

function debutYearCell(guess: number, target: number): AttrCell<number> {
  if (guess === target) return { value: guess, state: "equal" };
  if (Math.abs(guess - target) === 1) return { value: guess, state: "near" };
  return { value: guess, state: target > guess ? "higher" : "lower" };
}

function heightCell(guessCm: number, targetCm: number): AttrCell<HeightBucket> {
  const g = heightBucket(guessCm);
  const t = heightBucket(targetCm);
  if (g === t) return { value: g, state: "equal" };
  const dist = Math.abs(BUCKET_ORDER.indexOf(g) - BUCKET_ORDER.indexOf(t));
  return { value: g, state: dist === 1 ? "near" : "wrong" };
}

function birthMonthCell(guess: Month, target: Month): AttrCell<Month> {
  if (guess === target) return { value: guess, state: "equal" };
  const gi = MONTHS.indexOf(guess);
  const ti = MONTHS.indexOf(target);
  // Circular distance over 12 months.
  const raw = Math.abs(gi - ti);
  const dist = Math.min(raw, 12 - raw);
  return { value: guess, state: dist === 1 ? "near" : "wrong" };
}

export function compareGuess(guess: Talent, target: Talent): GuessDiff {
  return {
    talentId: guess.id,
    name: exactCell(guess.name, guess.id === target.id),
    branch: exactCell(guess.branch, guess.branch === target.branch),
    debutYear: debutYearCell(guess.debutYear, target.debutYear),
    archetype: exactCell(guess.archetype, guess.archetype === target.archetype),
    height: heightCell(guess.heightCm, target.heightCm),
    birthMonth: birthMonthCell(guess.birthMonth, target.birthMonth),
  };
}
