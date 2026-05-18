import { useGame } from "../state/game.js";

export function Header(): JSX.Element {
  const setHelpOpen = useGame((s) => s.setHelpOpen);
  return (
    <header className="relative flex flex-col items-center pt-6 pb-2">
      <button
        type="button"
        aria-label="How to play"
        onClick={() => setHelpOpen(true)}
        className="absolute right-4 top-6 h-9 w-9 rounded-full border-2 border-holo-accent text-holo-accent font-bold leading-none hover:bg-white"
      >
        ?
      </button>
      <h1 className="flex items-center gap-2 text-5xl font-extrabold tracking-tight">
        <span className="text-holo-accent">HOLO</span>
        <span aria-hidden className="text-holo-accent">✦</span>
        <span className="text-holo-ink">DLE</span>
      </h1>
      <p className="mt-1 text-xs font-semibold uppercase tracking-[0.18em] text-holo-muted">
        Daily Hololive Talent Guessing Game
      </p>
    </header>
  );
}
