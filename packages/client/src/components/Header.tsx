import { useGame } from "../state/game.js";

// Wordmark: lowercase `holodle` in Fredoka. The earlier draft had a
// shimmering holographic gradient + four twinkling sparkles; that read
// as too busy at the top of the screen. This version uses a static
// two-stop gradient (accent → ink) so the wordmark still has character
// without animating, and no decorative sparkles compete with the
// background pattern.
export function Header(): JSX.Element {
  const setHelpOpen = useGame((s) => s.setHelpOpen);
  // Discord mobile overlays its own header bar (the "Holodle / Leave" chrome
  // visible at the top of the iframe) on top of our content. The first ~48px
  // of our header are hidden behind it, so we add extra top padding on
  // narrow viewports. The desktop iframe doesn't have this overlay.
  return (
    <header className="relative flex flex-col items-center pt-14 pb-4 sm:pt-8 sm:pb-6">
      <button
        type="button"
        aria-label="How to play"
        onClick={() => setHelpOpen(true)}
        className="absolute right-2 top-14 h-8 w-8 rounded-full border-2 border-holo-accent text-holo-accent text-sm font-bold leading-none hover:bg-holo-accent/10 sm:right-4 sm:top-8 sm:h-9 sm:w-9 sm:text-base"
      >
        ?
      </button>
      <h1
        className="font-display text-5xl font-semibold tracking-tight sm:text-7xl"
        style={{
          // Static two-stop gradient: accent at the top fading into ink
          // at the bottom. Reads as a single colour at a glance but has
          // a touch of depth up close. No animation.
          background:
            "linear-gradient(180deg, rgb(var(--holo-accent)) 0%, rgb(var(--holo-ink)) 100%)",
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          WebkitTextFillColor: "transparent",
          color: "transparent",
        }}
      >
        holodle
      </h1>
      <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-holo-muted sm:mt-4 sm:text-xs">
        Daily Hololive Talent Guessing Game
      </p>
    </header>
  );
}
