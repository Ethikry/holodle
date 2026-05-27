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
          // Three-stop vertical gradient (accent → ink → accent) sized
          // to 200% of the text height so the background can scroll
          // through it. The `wordmarkBreathe` keyframe shifts the
          // gradient position over 12s, so the wordmark slowly drifts
          // between accent-heavy on top and accent-heavy on bottom.
          // Almost imperceptible — adds life without distraction.
          background:
            "linear-gradient(180deg, rgb(var(--holo-accent)) 0%, rgb(var(--holo-ink)) 50%, rgb(var(--holo-accent)) 100%)",
          backgroundSize: "100% 200%",
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          WebkitTextFillColor: "transparent",
          color: "transparent",
          animation: "wordmarkBreathe 12s ease-in-out infinite",
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
