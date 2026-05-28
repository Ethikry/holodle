import type { GuessDiff } from "@holodle/shared";
import { patchPrefs } from "../net/api.js";
import { useGame } from "../state/game.js";
import { GuessRow } from "./GuessRow.js";

// First-launch onboarding. Shown once per browser (gated by the
// `holodle-welcomed` localStorage key set in App.tsx + the Zustand
// `welcomeOpen` action). The intent is to land users with a tiny "I
// get it" moment before they're staring at an empty grid — show the
// colour rules and a 3-row example board with real talent stats.

// Synthetic GuessDiff rows for the example board. The hypothetical
// "answer" is Ceres Fauna (EN, Promise → Gen 2, Kirin, Light Green,
// 164cm Tall, March). The four rows show a progression from a complete
// miss to the solve:
//   1. Usada Pekora — JP / Gen 3 / Animal / Light Blue / Med / January
//      → every cell red.
//   2. Anya Melfissa — ID / Gen 2 / Dagger / Yellow / Smol / March
//      → gen matches (cross-branch Gen 2 ↔ Gen 2) + birthMonth equal.
//   3. Takanashi Kiara — EN / Gen 1 (Myth) / Bird / Orange / Tall / July
//      → branch matches (both EN) + height equal.
//   4. Ceres Fauna — full match, all green.
// All values mirror talent_data.json verbatim.
const EXAMPLE_ROWS: GuessDiff[] = [
  {
    talentId: "usada-pekora",
    branch: { value: "JP", state: "wrong" },
    group: { value: "Gen 3", state: "wrong" },
    penlightColor: { value: "Light Blue", state: "wrong" },
    archetype: { value: "Animal", state: "wrong" },
    height: { value: "Med", state: "wrong" },
    birthMonth: { value: "January", state: "wrong" },
  },
  {
    talentId: "anya-melfissa",
    branch: { value: "ID", state: "wrong" },
    group: { value: "Gen 2", state: "equal" },
    penlightColor: { value: "Yellow", state: "wrong" },
    archetype: { value: "Dagger", state: "wrong" },
    height: { value: "Smol", state: "wrong" },
    birthMonth: { value: "March", state: "equal" },
  },
  {
    talentId: "takanashi-kiara",
    branch: { value: "EN", state: "equal" },
    group: { value: "Gen 1 (Myth)", state: "wrong" },
    penlightColor: { value: "Orange", state: "wrong" },
    archetype: { value: "Bird", state: "wrong" },
    height: { value: "Tall", state: "equal" },
    birthMonth: { value: "July", state: "wrong" },
  },
  {
    talentId: "ceres-fauna",
    branch: { value: "EN", state: "equal" },
    group: { value: "Gen 2 (Promise)", state: "equal" },
    penlightColor: { value: "Light Green", state: "equal" },
    archetype: { value: "Kirin", state: "equal" },
    height: { value: "Tall", state: "equal" },
    birthMonth: { value: "March", state: "equal" },
  },
];

export function WelcomeOverlay(): JSX.Element | null {
  const { welcomeOpen, setWelcomeOpen, talents, accessToken, prefs, setPrefs } = useGame();
  if (!welcomeOpen) return null;

  const handleDismiss = (): void => {
    // Close immediately for snappy UX, then persist the flag in the
    // background. Failure to persist just means the overlay pops once
    // more next launch — not catastrophic, the user gets a chance to
    // dismiss again.
    setWelcomeOpen(false);
    if (accessToken && !prefs.welcomed) {
      setPrefs({ ...prefs, welcomed: true });
      void patchPrefs(accessToken, { welcomed: true }).catch(() => {
        // Roll back the optimistic update so a retry from the Help
        // modal's "Replay welcome" stays consistent with the server.
        setPrefs({ ...prefs, welcomed: false });
      });
    }
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
          Guess today's Hololive talent in six tries. Each guess grades
          six attributes — every cell lands green or red.
        </p>

        {/* Colour key — same copy + chips as HelpModal so the two
            surfaces stay aligned. */}
        <ul className="mx-auto mt-4 w-full max-w-md space-y-2">
          <li className="flex items-center gap-3">
            <span className="cell-equal w-24 shrink-0">Green</span>
            <span className="text-sm">Exact match.</span>
          </li>
          <li className="flex items-center gap-3">
            <span className="cell-wrong w-24 shrink-0">Red</span>
            <span className="text-sm">No match.</span>
          </li>
        </ul>
        <p className="mx-auto mt-3 max-w-md text-center text-xs text-holo-muted">
          Generation matches across branches — Aqua's{" "}
          <span className="font-semibold">Gen 2</span> matches Fauna's{" "}
          <span className="font-semibold">Gen 2 (Promise)</span>.
        </p>

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
              className="grid grid-cols-[40px_repeat(6,minmax(0,1fr))] items-end gap-1 px-1 pb-2 text-center text-[9px] font-semibold uppercase tracking-wider text-holo-muted sm:grid-cols-[64px_repeat(6,minmax(0,1fr))] sm:gap-2 sm:text-[10px]"
            >
              <div className="break-words leading-tight">Talent</div>
              <div className="break-words leading-tight">Branch</div>
              <div className="break-words leading-tight">Gen</div>
              <div className="break-words leading-tight">Penlight</div>
              <div className="break-words leading-tight">Archetype</div>
              <div className="break-words leading-tight">Height</div>
              <div className="break-words leading-tight">Birthday</div>
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
