import type { GuessDiff } from "@holodle/shared";
import { useGame } from "../state/game.js";
import { GuessRow } from "./GuessRow.js";

// First-launch onboarding. Shown once per browser (gated by the
// `holodle-welcomed` localStorage key set in App.tsx + cleared on
// dismiss). The intent is to land users with a tiny "I get it" moment
// before they're staring at an empty grid — show the colour rules and a
// 3-row example board with real talent avatars from the catalog.

// Synthetic GuessDiff rows for the example board. Each row demonstrates
// a different mix of states so a glance teaches: partial = half-right,
// equal = full match. talentId values reference real catalog members
// when present (GuessRow falls back to a "?" avatar if absent, which
// is fine — the chip colours still teach the rules).
const EXAMPLE_ROWS: GuessDiff[] = [
  // Row 1 — early guess. Branch matches but generation doesn't, hence
  // the yellow Generation cell. Everything else missed.
  {
    talentId: "ninomae-inanis",
    group: { value: "EN\nGen 1 (Myth)", state: "partial" },
    penlightColor: { value: "Purple", state: "wrong" },
    archetype: { value: "Eldritch", state: "wrong" },
    height: { value: "Med", state: "wrong" },
    birthMonth: { value: "May", state: "wrong" },
  },
  // Row 2 — closing in. Generation, height, and birth month line up;
  // penlight + archetype still wrong.
  {
    talentId: "ouro-kronii",
    group: { value: "EN\nGen 2 (Promise)", state: "equal" },
    penlightColor: { value: "Indigo", state: "wrong" },
    archetype: { value: "Eldritch", state: "wrong" },
    height: { value: "Tall", state: "equal" },
    birthMonth: { value: "June", state: "equal" },
  },
  // Row 3 — solved.
  {
    talentId: "ceres-fauna",
    group: { value: "EN\nGen 2 (Promise)", state: "equal" },
    penlightColor: { value: "Green", state: "equal" },
    archetype: { value: "Spirit", state: "equal" },
    height: { value: "Tall", state: "equal" },
    birthMonth: { value: "June", state: "equal" },
  },
];

export function WelcomeOverlay({ onDismiss }: { onDismiss: () => void }): JSX.Element {
  const talents = useGame((s) => s.talents);

  const handleDismiss = (): void => {
    try {
      localStorage.setItem("holodle-welcomed", "1");
    } catch {
      // localStorage may be unavailable in private-mode iframes — the
      // user just sees the overlay again next launch, which is fine.
    }
    onDismiss();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to holodle"
      className="fixed inset-0 z-40 overflow-y-auto bg-holo-bg/95 backdrop-blur-sm animate-overlayEnter"
    >
      <div className="mx-auto flex min-h-full max-w-2xl flex-col px-4 py-8 sm:py-10">
        {/* Heading — accent-tinted gradient wordmark style, lowercase. */}
        <h1
          className="text-center font-display text-4xl font-semibold tracking-tight sm:text-5xl"
          style={{
            background:
              "linear-gradient(180deg, rgb(var(--holo-accent)) 0%, rgb(var(--holo-ink)) 100%)",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            WebkitTextFillColor: "transparent",
            color: "transparent",
          }}
        >
          welcome to holodle
        </h1>
        <p className="mt-3 text-center text-sm sm:text-base">
          Guess today's Hololive talent in six tries. After each guess every
          attribute turns one of three colours:
        </p>

        {/* Colour key — same copy + chips as HelpModal so the two
            surfaces stay aligned. */}
        <ul className="mx-auto mt-4 w-full max-w-md space-y-2">
          <li className="flex items-center gap-3">
            <span className="cell-equal w-24 shrink-0">Green</span>
            <span className="text-sm">Exact match.</span>
          </li>
          <li className="flex items-center gap-3">
            <span className="cell-partial w-24 shrink-0">Yellow</span>
            <span className="text-sm">
              Generation only: branch or generation matches, but not both.
            </span>
          </li>
          <li className="flex items-center gap-3">
            <span className="cell-wrong w-24 shrink-0">Red</span>
            <span className="text-sm">No match.</span>
          </li>
        </ul>

        {/* Example board — three synthetic rows showing the partial →
            equal → solved progression so the colour rules click in
            context. */}
        <section className="mt-6">
          <h2 className="px-1 text-center text-xs font-semibold uppercase tracking-wider text-holo-muted">
            Example
          </h2>
          <div className="mx-auto mt-2 w-full max-w-xl">
            <div
              role="row"
              className="grid grid-cols-[48px_repeat(5,minmax(0,1fr))] items-end gap-1 px-1 pb-2 text-center text-[9px] font-semibold uppercase tracking-wider text-holo-muted sm:grid-cols-[72px_repeat(5,minmax(0,1fr))] sm:gap-2 sm:text-[11px]"
            >
              <div className="break-words leading-tight">Talent</div>
              <div className="break-words leading-tight">Generation</div>
              <div className="break-words leading-tight">Penlight</div>
              <div className="break-words leading-tight">Archetype</div>
              <div className="break-words leading-tight">Height</div>
              <div className="break-words leading-tight">Birth Month</div>
            </div>
            <div className="space-y-2">
              {EXAMPLE_ROWS.map((diff, i) => (
                <GuessRow key={i} diff={diff} talents={talents} />
              ))}
            </div>
          </div>
        </section>

        {/* Where the rest of the UI lives. */}
        <p className="mx-auto mt-6 max-w-md text-center text-xs text-holo-muted sm:text-sm">
          Tap the <span className="font-bold text-holo-accent">?</span> in the
          corner any time to change themes or recap settings.
        </p>

        {/* CTA — single accent-coloured button. Centered. */}
        <div className="mt-6 flex justify-center pb-4">
          <button
            type="button"
            onClick={handleDismiss}
            className="rounded-full bg-holo-accent px-6 py-2 text-sm font-semibold text-holo-card shadow-card transition hover:opacity-90 sm:text-base"
          >
            Let's play
          </button>
        </div>
      </div>
    </div>
  );
}
