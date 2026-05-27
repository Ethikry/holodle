import { useGame } from "../state/game.js";

// The wordmark renders `holodle` in lowercase Fredoka with a slow
// holographic-gradient shimmer (the gradient slides across the letters
// via the `shimmer` animation in tailwind.config.ts / styles.css). A
// handful of decorative ✨ are absolutely positioned around the
// wordmark and twinkle on a stagger — gives the header an idol/pop
// vibe without leaning on a literal star inside the wordmark itself.
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
      <div className="relative inline-block">
        <h1
          className="font-display text-5xl font-semibold tracking-tight sm:text-7xl"
          style={{
            // Holographic gradient: accent → pink → accent. The
            // background-clip:text + 200% width + animated background-
            // position gives a slow shimmer that tracks the active
            // theme's accent (since the stops use the CSS variable).
            background:
              "linear-gradient(90deg, rgb(var(--holo-accent)) 0%, rgb(255 105 180) 35%, rgb(180 130 255) 60%, rgb(var(--holo-accent)) 100%)",
            backgroundSize: "200% 100%",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            WebkitTextFillColor: "transparent",
            color: "transparent",
            animation: "shimmer 6s linear infinite",
          }}
        >
          holodle
        </h1>
        {/* Decorative twinkling sparkles around the wordmark. aria-hidden
            because they don't carry meaning — the wordmark itself is the
            label. Each gets its own staggered animation-delay. */}
        <span
          aria-hidden
          className="pointer-events-none absolute -top-3 -left-4 text-xl text-holo-accent animate-twinkle sm:-top-4 sm:-left-6 sm:text-2xl"
          style={{ animationDelay: "0s" }}
        >
          ✦
        </span>
        <span
          aria-hidden
          className="pointer-events-none absolute -top-1 -right-5 text-base text-holo-accent animate-twinkle sm:-top-2 sm:-right-7 sm:text-xl"
          style={{ animationDelay: "0.8s" }}
        >
          ✧
        </span>
        <span
          aria-hidden
          className="pointer-events-none absolute -bottom-2 left-2 text-sm text-holo-accent animate-twinkle sm:-bottom-3 sm:left-4 sm:text-base"
          style={{ animationDelay: "1.6s" }}
        >
          ✦
        </span>
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-1 -right-3 text-xs text-holo-accent animate-twinkle sm:bottom-2 sm:-right-5 sm:text-sm"
          style={{ animationDelay: "1.2s" }}
        >
          ✧
        </span>
      </div>
      <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-holo-muted sm:mt-4 sm:text-xs">
        Daily Hololive Talent Guessing Game
      </p>
    </header>
  );
}
