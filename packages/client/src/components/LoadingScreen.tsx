// Full-iframe loading state shown while the bootstrap effect resolves
// (talent catalog fetch + Discord OAuth + per-user daily/stats fetch +
// socket connection). The whole bootstrap typically takes 3–5s in the
// Activity iframe; rendering this in place of a half-populated UI avoids
// the flash of empty stat cards and the empty-state "No talents loaded
// yet" banner during that window.
export function LoadingScreen(): JSX.Element {
  return (
    <main className="flex min-h-full flex-col items-center justify-center px-6 text-center">
      <h1 className="flex items-center gap-2 text-5xl font-extrabold tracking-tight">
        <span className="text-holo-accent">HOLO</span>
        <span aria-hidden className="text-holo-accent">
          ✦
        </span>
        <span className="text-holo-ink">DLE</span>
      </h1>
      <p className="mt-1 text-xs font-semibold uppercase tracking-[0.18em] text-holo-muted">
        Daily Hololive Talent Guessing Game
      </p>

      <div
        role="status"
        aria-live="polite"
        aria-label="Loading"
        className="mt-10 flex items-center gap-2"
      >
        {/* Three staggered pulsing dots. Tailwind's animate-pulse keyframes
            run 1→0.5→1 opacity over 2s; the inline animation-delay shifts
            each dot's phase so they ripple. */}
        <span
          className="h-3 w-3 animate-pulse rounded-full bg-holo-accent"
          style={{ animationDelay: "0ms" }}
        />
        <span
          className="h-3 w-3 animate-pulse rounded-full bg-holo-accent"
          style={{ animationDelay: "200ms" }}
        />
        <span
          className="h-3 w-3 animate-pulse rounded-full bg-holo-accent"
          style={{ animationDelay: "400ms" }}
        />
      </div>
      <p className="mt-3 text-sm text-holo-muted">Loading…</p>
    </main>
  );
}
