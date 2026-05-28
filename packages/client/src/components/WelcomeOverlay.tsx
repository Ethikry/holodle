import type { GuessDiff } from "@holodle/shared";
import { useGame } from "../state/game.js";
import { GuessRow } from "./GuessRow.js";

// First-launch onboarding. Shown once per browser (gated by the
// `holodle-welcomed` localStorage key set in App.tsx + the Zustand
// `welcomeOpen` action). The intent is to land users with a tiny "I
// get it" moment before they're staring at an empty grid — show the
// colour rules and a 3-row example board with real talent stats.

// Synthetic GuessDiff rows for the example board. The hypothetical
// "answer" is Ceres Fauna (EN Promise Gen 2, Kirin, Light Green, 164cm
// Tall, March). The three rows show:
//   1. Minato Aqua — every cell red (no overlap on any attribute)
//   2. Takanashi Kiara — group partial (EN matches, Myth ≠ Promise)
//      + height equal (both Tall), other cells red
//   3. Ceres Fauna — full match, all green
// All values mirror talent_data.json verbatim so the example doesn't
// claim "Eldritch" archetypes or wrong birth months.
const EXAMPLE_ROWS: GuessDiff[] = [
  {
    talentId: "minato-aqua",
    group: { value: "JP\nGen 2", state: "wrong" },
    penlightColor: { value: "Light Pink", state: "wrong" },
    archetype: { value: "Human", state: "wrong" },
    height: { value: "Smol", state: "wrong" },
    birthMonth: { value: "December", state: "wrong" },
  },
  {
    talentId: "takanashi-kiara",
    group: { value: "EN\nGen 1 (Myth)", state: "partial" },
    penlightColor: { value: "Orange", state: "wrong" },
    archetype: { value: "Bird", state: "wrong" },
    height: { value: "Tall", state: "equal" },
    birthMonth: { value: "July", state: "wrong" },
  },
  {
    talentId: "ceres-fauna",
    group: { value: "EN\nGen 2 (Promise)", state: "equal" },
    penlightColor: { value: "Light Green", state: "equal" },
    archetype: { value: "Kirin", state: "equal" },
    height: { value: "Tall", state: "equal" },
    birthMonth: { value: "March", state: "equal" },
  },
];

export function WelcomeOverlay(): JSX.Element | null {
  const { welcomeOpen, setWelcomeOpen, talents } = useGame();
  if (!welcomeOpen) return null;

  const handleDismiss = (): void => {
    try {
      localStorage.setItem("holodle-welcomed", "1");
    } catch {
      // localStorage may be unavailable in private-mode iframes — the
      // user just sees the overlay again next launch, which is fine.
    }
    setWelcomeOpen(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to holodle"
      // pt-14 mirrors Header.tsx: Discord mobile overlays ~48px of its
      // own chrome at the top of the iframe, so anything inside the
      // first ~48px gets clipped. Desktop gets a smaller pt-10 since
      // there's no overlay there.
      className="fixed inset-0 z-40 overflow-y-auto bg-holo-bg/95 backdrop-blur-sm animate-overlayEnter"
    >
      <div className="mx-auto flex min-h-full max-w-2xl flex-col px-4 pt-14 pb-8 sm:pt-10 sm:pb-10">
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
              Group only: branch or generation matches, but not both.
            </span>
          </li>
          <li className="flex items-center gap-3">
            <span className="cell-wrong w-24 shrink-0">Red</span>
            <span className="text-sm">No match.</span>
          </li>
        </ul>

        {/* Example board — three synthetic rows showing the progression
            from a complete miss (Aqua) → narrowing in (Kiara, partial
            group + equal height) → solved (Fauna). */}
        <section className="mt-6">
          <h2 className="px-1 text-center text-xs font-semibold uppercase tracking-wider text-holo-muted">
            Example — the answer is Ceres Fauna
          </h2>
          <div className="mx-auto mt-2 w-full max-w-xl">
            <div
              role="row"
              className="grid grid-cols-[48px_repeat(5,minmax(0,1fr))] items-end gap-1 px-1 pb-2 text-center text-[9px] font-semibold uppercase tracking-wider text-holo-muted sm:grid-cols-[72px_repeat(5,minmax(0,1fr))] sm:gap-2 sm:text-[11px]"
            >
              <div className="break-words leading-tight">Talent</div>
              <div className="break-words leading-tight">Group</div>
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
          corner any time to change themes, settings, or replay this welcome.
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
