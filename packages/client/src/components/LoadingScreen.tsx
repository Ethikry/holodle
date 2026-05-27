// Full-iframe loading state shown while the bootstrap effect resolves
// (talent catalog fetch + Discord OAuth + per-user daily/stats fetch +
// socket connection). The whole bootstrap typically takes 3–5s in the
// Activity iframe; rendering this in place of a half-populated UI avoids
// the flash of empty stat cards and the empty-state "No talents loaded
// yet" banner during that window.
//
// The wordmark is an italic lowercase `holodle` with a classic
// skeleton-loader shimmer — a bright highlight band sweeps across the
// muted base colour, looped. The shimmer alone communicates "we're
// working on it" so no separate spinner / pulse-dots are needed. Both
// the base and highlight use --holo-* variables so the loading screen
// renders in the user's persisted theme (applied via applyPersistedTheme
// in main.tsx before React mounts).
export function LoadingScreen(): JSX.Element {
  return (
    <main className="flex min-h-full flex-col items-center justify-center px-6 text-center">
      <h1
        className="font-display text-6xl font-semibold italic tracking-tight sm:text-8xl"
        style={{
          // Skeleton-loader gradient: muted base with a bright accent
          // band roughly 20% wide. background-size:200% gives the
          // shimmer keyframe room to sweep the highlight across.
          background:
            "linear-gradient(90deg, rgb(var(--holo-muted) / 0.45) 0%, rgb(var(--holo-muted) / 0.45) 40%, rgb(var(--holo-accent)) 50%, rgb(var(--holo-muted) / 0.45) 60%, rgb(var(--holo-muted) / 0.45) 100%)",
          backgroundSize: "200% 100%",
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          WebkitTextFillColor: "transparent",
          color: "transparent",
          animation: "shimmer 1.8s linear infinite",
        }}
      >
        holodle
      </h1>
      <p
        role="status"
        aria-live="polite"
        className="mt-6 text-xs font-semibold uppercase tracking-[0.22em] text-holo-muted sm:text-sm"
      >
        loading…
      </p>
    </main>
  );
}
