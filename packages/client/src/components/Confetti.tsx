import { useEffect, useMemo, useState } from "react";
import { useGame } from "../state/game.js";

// One-shot confetti burst. Mounts the moment a guess transitions the
// game to "won" and self-unmounts after the animation completes. Lives
// as a fullscreen overlay (`fixed inset-0 pointer-events-none`) so the
// pieces fly across the entire viewport without interfering with
// clicks underneath. Pure CSS — each piece is a small absolutely-
// positioned div animated via the `confettiBurst` keyframe (see
// tailwind.config.ts). Per-piece direction comes from inline CSS
// variables `--cf-x` / `--cf-y` so a single keyframe drives every
// trajectory.

const PIECE_COUNT = 28;

// Theme-aware accent palette. Use --holo-* variables so the confetti
// colours track whichever theme the user has active — gold pieces in
// Cadence, sky-blue in Sky, etc. Falling back to a couple of bright
// fixed hues for variety.
const COLORS = [
  "rgb(var(--holo-accent))",
  "rgb(var(--holo-ok))",
  "rgb(var(--holo-okBd))",
  "#f4cf5e",
  "#e6398f",
  "#5aa7ff",
];

interface Piece {
  x: number;
  y: number;
  rot: number;
  color: string;
  delay: number;
  size: number;
}

// Pre-compute the piece geometry once per win. Same `status` →
// `won` transition mounts a fresh component, so this runs once per
// celebration. Using Math.random is fine here — there's no
// determinism requirement for decoration.
function generatePieces(): Piece[] {
  const out: Piece[] = [];
  for (let i = 0; i < PIECE_COUNT; i++) {
    // Spread pieces across a full 360° arc but bias slightly downward
    // so most pieces fall into view rather than shooting off the top.
    const angle = (Math.random() - 0.5) * 2 * Math.PI;
    const distance = 180 + Math.random() * 220; // px
    const x = Math.cos(angle) * distance;
    // Bias y downward by adding a positive fall offset.
    const y = Math.sin(angle) * distance + 120 + Math.random() * 80;
    out.push({
      x: Math.round(x),
      y: Math.round(y),
      rot: Math.round(Math.random() * 360),
      color: COLORS[i % COLORS.length]!,
      delay: Math.round(Math.random() * 120),
      size: 6 + Math.round(Math.random() * 6),
    });
  }
  return out;
}

export function Confetti(): JSX.Element | null {
  const status = useGame((s) => s.status);
  const [active, setActive] = useState(false);
  const pieces = useMemo<Piece[]>(() => (active ? generatePieces() : []), [active]);

  // Trigger on the playing → won transition. The burst is timed to
  // coincide with the cell-sweep glow (which starts ~820ms after the
  // guess lands), so we mount immediately on win and let CSS-side
  // `animation-delay` on each piece spread the entry timing.
  useEffect(() => {
    if (status !== "won") return;
    setActive(true);
    const t = window.setTimeout(() => setActive(false), 1600);
    return () => window.clearTimeout(t);
  }, [status]);

  if (!active) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-30 overflow-hidden"
    >
      {/* Burst origin: centered horizontally, just above the vertical
          middle so pieces fall through the guess board area. */}
      <div className="absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2">
        {pieces.map((p, i) => (
          <span
            key={i}
            className="absolute block rounded-[2px] animate-confettiBurst"
            style={
              {
                width: `${p.size}px`,
                height: `${p.size * 1.4}px`,
                backgroundColor: p.color,
                transform: `rotate(${p.rot}deg)`,
                animationDelay: `${800 + p.delay}ms`,
                ["--cf-x" as string]: `${p.x}px`,
                ["--cf-y" as string]: `${p.y}px`,
              } as React.CSSProperties
            }
          />
        ))}
      </div>
    </div>
  );
}
