import { useGame } from "../state/game.js";
import { GuessRow } from "./GuessRow.js";

const COLUMN_HEADERS: Array<{ label: string; align?: string }> = [
  { label: "Talent" },
  { label: "Group" },
  { label: "Penlight" },
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
    <section className="mx-1 my-2 sm:mx-2" aria-label="Your guesses">
      <div className="mx-auto w-full max-w-3xl">
        <div
          role="row"
          className="grid grid-cols-[48px_repeat(5,minmax(0,1fr))] items-end gap-1 px-1 pb-2 text-center text-[9px] font-semibold uppercase tracking-wider text-holo-muted sm:grid-cols-[72px_repeat(5,minmax(0,1fr))] sm:gap-2 sm:text-[11px]"
        >
          {COLUMN_HEADERS.map((h) => (
            <div role="columnheader" key={h.label} className="break-words leading-tight">
              {h.label}
            </div>
          ))}
        </div>
        <div className="space-y-2">
          {history.map((diff, i) => (
            <GuessRow
              key={`${diff.talentId}-${i}`}
              diff={diff}
              talents={talents}
              // Only the most-recent row animates its cells in. Older
              // rows are static so re-renders don't restart the pop.
              isLatest={i === history.length - 1}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
