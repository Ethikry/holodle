import { useGame } from "../state/game.js";

export function Header(): JSX.Element {
  const setHelpOpen = useGame((s) => s.setHelpOpen);
  // Discord mobile overlays its own header bar (the "Holodle / Leave" chrome
  // visible at the top of the iframe) on top of our content. The first ~48px
  // of our header are hidden behind it, so we add extra top padding on
  // narrow viewports. The desktop iframe doesn't have this overlay.
  return (
    <header className="relative flex flex-col items-center pt-14 pb-2 sm:pt-6">
      <button
        type="button"
        aria-label="How to play"
        onClick={() => setHelpOpen(true)}
        className="absolute right-2 top-14 h-8 w-8 rounded-full border-2 border-holo-accent text-holo-accent text-sm font-bold leading-none hover:bg-white sm:right-4 sm:top-6 sm:h-9 sm:w-9 sm:text-base"
      >
        ?
      </button>
      <h1 className="flex items-center gap-2 text-3xl font-extrabold tracking-tight sm:text-5xl">
        <span className="text-holo-accent">HOLO</span>
        <span aria-hidden className="text-holo-accent">✦</span>
        <span className="text-holo-ink">DLE</span>
      </h1>
      <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-holo-muted sm:text-xs">
        Daily Hololive Talent Guessing Game
      </p>
    </header>
  );
}
