import { useGame } from "../state/game.js";

export function HelpModal(): JSX.Element | null {
  const { helpOpen, setHelpOpen } = useGame();
  if (!helpOpen) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => setHelpOpen(false)}
    >
      <div
        className="card max-w-md w-full p-6 text-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">How to play</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={() => setHelpOpen(false)}
            className="rounded-full px-2 text-holo-muted hover:bg-holo-bg"
          >
            ✕
          </button>
        </div>
        <p className="mt-3">
          Guess today's Hololive talent in six tries. After each guess each attribute
          turns:
        </p>
        <ul className="mt-2 space-y-2">
          <li className="flex items-center gap-2">
            <span className="cell-equal w-24 shrink-0">Green</span>
            <span>Exact match.</span>
          </li>
          <li className="flex items-center gap-2">
            <span className="cell-wrong w-24 shrink-0">Red</span>
            <span>No match. ↑ / ↓ point toward the target for years.</span>
          </li>
        </ul>
        <p className="mt-3 text-xs text-holo-muted">
          A new puzzle drops at midnight in your timezone. Streaks roll
          over with your local day.
        </p>
      </div>
    </div>
  );
}
