import type { Config } from "tailwindcss";

// Colours and animations live in CSS variables so the runtime theme
// picker can swap palettes without rebuilding the bundle. See
// `src/styles.css` for the actual values of each `--holo-*` variable
// under the various .theme-* classes.

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Each --holo-* CSS variable holds a space-separated RGB triplet
        // ("250 245 238") so Tailwind's `bg-holo-x/60` opacity modifier
        // can splice in the alpha channel at compile time. See
        // src/styles.css for the per-theme values.
        holo: {
          bg: "rgb(var(--holo-bg) / <alpha-value>)",
          card: "rgb(var(--holo-card) / <alpha-value>)",
          ink: "rgb(var(--holo-ink) / <alpha-value>)",
          accent: "rgb(var(--holo-accent) / <alpha-value>)",
          ok: "rgb(var(--holo-ok) / <alpha-value>)",
          okBg: "rgb(var(--holo-ok-bg) / <alpha-value>)",
          okBd: "rgb(var(--holo-ok-bd) / <alpha-value>)",
          bad: "rgb(var(--holo-bad) / <alpha-value>)",
          badBg: "rgb(var(--holo-bad-bg) / <alpha-value>)",
          badBd: "rgb(var(--holo-bad-bd) / <alpha-value>)",
          muted: "rgb(var(--holo-muted) / <alpha-value>)",
        },
      },
      fontFamily: {
        // Display font for the wordmark + headings. Fredoka has a rounded,
        // friendly geometric feel that reads as idol/kawaii without being
        // cartoonish. Loaded via index.html <link>.
        display: ["'Fredoka'", "ui-rounded", "ui-sans-serif", "system-ui", "sans-serif"],
        // Body copy: M PLUS Rounded 1c — soft rounded sans designed for
        // Japanese + Latin glyphs, fits the hololive aesthetic.
        body: ["'M PLUS Rounded 1c'", "ui-rounded", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "var(--holo-card-shadow)",
      },
      keyframes: {
        // Each cell in a freshly-landed guess row pops in. Slight overshoot
        // gives a tactile "graded" feel without being noisy.
        cellPop: {
          "0%": { transform: "scale(0.7)", opacity: "0" },
          "60%": { transform: "scale(1.06)", opacity: "1" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        // Full-screen overlays (RecapScreen) fade + ever-so-slightly scale in.
        overlayEnter: {
          "0%": { transform: "scale(0.985)", opacity: "0" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        // Smaller modals (HelpModal) use a tighter version.
        modalEnter: {
          "0%": { transform: "scale(0.96)", opacity: "0" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        // Per-player tile entrance inside the RecapScreen; per-index delay
        // applied via inline style.
        tileEnter: {
          "0%": { transform: "translateY(6px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        // Win banner emphasis — text-shadow glows then settles. The
        // glow colour rebuilds the accent rgb() from the CSS variable so
        // it tracks whichever theme is active.
        pulseGlow: {
          "0%, 100%": { textShadow: "0 0 0 transparent" },
          "50%": { textShadow: "0 0 16px rgb(var(--holo-accent))" },
        },
        // Skeleton-loader shimmer used by LoadingScreen — the
        // highlight band sweeps RIGHT across the wordmark, then
        // sweeps back LEFT, and so on. The single keyframe encodes
        // both halves of the ping-pong so the animation can run a
        // plain `linear infinite` without needing `alternate`.
        shimmer: {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "200% 50%" },
        },
        // Per-cell victory pulse. Tracks --holo-ok so it glows whatever
        // green the active theme uses. The whole row plays this with a
        // 60ms-per-cell stagger AFTER cellPop completes, so the user
        // sees the cells fill in, then a left→right sweep of glow.
        winSweep: {
          "0%, 100%": {
            boxShadow: "0 0 0 0 rgb(var(--holo-ok) / 0)",
            transform: "scale(1)",
          },
          "50%": {
            boxShadow: "0 0 18px 4px rgb(var(--holo-ok) / 0.7)",
            transform: "scale(1.06)",
          },
        },
        // Single confetti piece: flies outward + downward while
        // rotating, fading out at the end. The --cf-x / --cf-y CSS
        // variables on each piece supply the per-piece direction so a
        // burst of many pieces with different randomised values
        // produces an explosion.
        confettiBurst: {
          "0%": {
            transform: "translate(0, 0) rotate(0deg)",
            opacity: "1",
          },
          "100%": {
            transform: "translate(var(--cf-x), var(--cf-y)) rotate(720deg)",
            opacity: "0",
          },
        },
      },
      animation: {
        cellPop: "cellPop 320ms cubic-bezier(.34,1.56,.64,1) both",
        overlayEnter: "overlayEnter 260ms ease-out both",
        modalEnter: "modalEnter 200ms ease-out both",
        tileEnter: "tileEnter 280ms ease-out both",
        pulseGlow: "pulseGlow 1200ms ease-in-out 1",
        // 2.6s = ~1.3s each direction. Slow enough that the reverse
        // sweep reads as deliberate (vs. a hard reset) but quick
        // enough to communicate "we're loading."
        shimmer: "shimmer 2.6s ease-in-out infinite",
        winSweep: "winSweep 360ms ease-out both",
        confettiBurst: "confettiBurst 1200ms cubic-bezier(.2,.6,.4,1) both",
      },
    },
  },
  plugins: [],
} satisfies Config;
