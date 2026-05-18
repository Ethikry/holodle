import { useGame } from "../state/game.js";
import { GuessRow } from "./GuessRow.js";

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
    <div className="mx-2 my-2 overflow-x-auto">
      <table className="mx-auto w-full max-w-3xl border-separate border-spacing-y-2">
        <thead>
          <tr className="text-xs font-semibold uppercase tracking-wider text-holo-muted">
            <th className="px-2 py-2">Talent</th>
            <th className="px-2 py-2">Name</th>
            <th className="px-2 py-2">Branch</th>
            <th className="px-2 py-2">Debut Year</th>
            <th className="px-2 py-2">Archetype</th>
            <th className="px-2 py-2">Height</th>
            <th className="px-2 py-2">Birth Month</th>
          </tr>
        </thead>
        <tbody>
          {history.map((diff, i) => (
            <GuessRow key={`${diff.talentId}-${i}`} diff={diff} talents={talents} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
