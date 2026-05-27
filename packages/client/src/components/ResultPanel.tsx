import { useGame } from "../state/game.js";

// The post-game celebration / answer reveal lives entirely on the
// RecapScreen overlay now — duplicating it inline below the grid is
// redundant. We keep just a small "View recap" affordance so a player
// who dismissed the overlay can pop it back open.
export function ResultPanel(): JSX.Element | null {
  const { status, setRecapOpen } = useGame();
  if (status === "playing") return null;

  const won = status === "won";
  return (
    <div className="mx-4 my-4 text-center">
      <button
        type="button"
        onClick={() => setRecapOpen(true)}
        className={`rounded-full border px-4 py-1.5 text-xs font-semibold ${
          won
            ? "border-holo-ok text-holo-ok hover:bg-holo-ok/10"
            : "border-holo-bad/60 text-holo-bad hover:bg-holo-bad/10"
        }`}
      >
        View recap
      </button>
    </div>
  );
}
