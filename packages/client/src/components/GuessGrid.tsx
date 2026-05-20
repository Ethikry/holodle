import { useGame } from "../state/game.js";
import { GuessRow } from "./GuessRow.js";

const COLUMN_HEADERS: Array<{ label: string; align?: string }> = [
  { label: "Talent" },
  { label: "Gen" },
  { label: "Branch" },
  { label: "Debut Year" },
  { label: "Archetype" },
  { label: "Height" },
  { label: "Birth Month" },
];

export function GuessGrid(): JSX.Element {
  const { history, talents } = useGame();
  if (history.length === 0) {
    return (
      <div className="mx-4 my-2 rounded-xl border border-dashed border-holo-muted/40 p-6 text-center text-sm text-holo-muted">
        Start guessing to see your clues here.
      </div>
    );
  }
  return (
    <section className="mx-2 my-2 overflow-x-auto" aria-label="Your guesses">
      <div className="mx-auto w-full max-w-3xl">
        <div
          role="row"
          className="grid grid-cols-[72px_repeat(6,minmax(0,1fr))] items-end gap-2 px-1 pb-2 text-center text-[11px] font-semibold uppercase tracking-wider text-holo-muted"
        >
          {COLUMN_HEADERS.map((h) => (
            <div role="columnheader" key={h.label} className="leading-tight">
              {h.label}
            </div>
          ))}
        </div>
        <div className="space-y-2">
          {history.map((diff, i) => (
            <GuessRow key={`${diff.talentId}-${i}`} diff={diff} talents={talents} />
          ))}
        </div>
      </div>
    </section>
  );
}
