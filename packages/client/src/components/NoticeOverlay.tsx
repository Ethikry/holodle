import type { TalentSummary } from "@holodle/shared";
import { patchPrefs } from "../net/api.js";
import { useGame } from "../state/game.js";
import {
  CURRENT_NOTICE_VERSION,
  HEIGHT_REBUCKET_MOVERS,
  type HeightMove,
} from "../notices.js";

// One-time "patch notes" overlay shown to returning players whose stored
// lastSeenNoticeVersion is behind CURRENT_NOTICE_VERSION. Dismissing it
// persists the bumped version server-side so it never reappears. Modeled on
// WelcomeOverlay (full-screen dialog, accent CTA) for visual consistency.

function MoverChip({
  move,
  talents,
}: {
  move: HeightMove;
  talents: TalentSummary[];
}): JSX.Element {
  const talent = talents.find((t) => t.id === move.talentId);
  const name = talent?.name ?? move.talentId;
  return (
    <li className="flex items-center gap-2 rounded-full border border-holo-accent/20 bg-holo-card/60 py-1 pl-1 pr-3">
      <span className="card flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden border border-holo-accent/30">
        {talent?.avatarUrl ? (
          <img
            src={talent.avatarUrl}
            alt={name}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : null}
      </span>
      <span className="truncate text-sm font-medium">{name}</span>
    </li>
  );
}

export function NoticeOverlay(): JSX.Element | null {
  const { noticeOpen, setNoticeOpen, talents, accessToken, prefs, setPrefs } =
    useGame();
  if (!noticeOpen) return null;

  const handleDismiss = (): void => {
    // Close immediately for snappy UX, then persist in the background.
    // Same optimistic-with-rollback shape as WelcomeOverlay: a failed
    // persist just means the notice pops once more next launch.
    setNoticeOpen(false);
    if (accessToken && prefs.lastSeenNoticeVersion < CURRENT_NOTICE_VERSION) {
      const prevVersion = prefs.lastSeenNoticeVersion;
      setPrefs({ ...prefs, lastSeenNoticeVersion: CURRENT_NOTICE_VERSION });
      void patchPrefs(accessToken, {
        lastSeenNoticeVersion: CURRENT_NOTICE_VERSION,
      }).catch(() => {
        setPrefs({ ...prefs, lastSeenNoticeVersion: prevVersion });
      });
    }
  };

  const movedUp = HEIGHT_REBUCKET_MOVERS.filter((m) => m.from === "Smol");
  const movedDown = HEIGHT_REBUCKET_MOVERS.filter((m) => m.from === "Tall");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Heights re-sorted"
      // pt-14 mirrors Header.tsx / WelcomeOverlay: Discord mobile overlays
      // ~48px of chrome at the top of the iframe.
      className="fixed inset-0 z-40 overflow-y-auto bg-holo-bg/95 backdrop-blur-sm animate-overlayEnter"
    >
      <div className="mx-auto flex min-h-full max-w-2xl flex-col px-4 pt-14 pb-8 sm:pt-10 sm:pb-10">
        <h1
          className="text-center font-display text-3xl font-semibold tracking-tight sm:text-4xl"
          style={{
            background:
              "linear-gradient(180deg, rgb(var(--holo-accent)) 0%, rgb(var(--holo-ink)) 100%)",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            WebkitTextFillColor: "transparent",
            color: "transparent",
          }}
        >
          heights re-sorted
        </h1>
        <p className="mx-auto mt-3 max-w-md text-center text-sm sm:text-base">
          We've widened the middle <span className="font-semibold">Med</span>{" "}
          band so the Height hint is more balanced. The buckets are now:
        </p>
        <ul className="mx-auto mt-4 flex w-full max-w-md flex-col gap-2 sm:flex-row sm:justify-center">
          <li className="cell-wrong rounded-xl px-3 py-2 text-center text-sm">
            <span className="font-semibold">Smol</span> · &lt;150cm
          </li>
          <li className="cell-equal rounded-xl px-3 py-2 text-center text-sm">
            <span className="font-semibold">Med</span> · 150–165cm
          </li>
          <li className="cell-partial rounded-xl px-3 py-2 text-center text-sm">
            <span className="font-semibold">Tall</span> · &gt;165cm
          </li>
        </ul>
        <p className="mx-auto mt-4 max-w-md text-center text-xs text-holo-muted">
          Everyone below moved into <span className="font-semibold">Med</span>.
          Nothing else changed.
        </p>

        <section className="mt-6">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-holo-muted">
            Were Smol → now Med
          </h2>
          <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {movedUp.map((m) => (
              <MoverChip key={m.talentId} move={m} talents={talents} />
            ))}
          </ul>
        </section>

        <section className="mt-5">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-holo-muted">
            Were Tall → now Med
          </h2>
          <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {movedDown.map((m) => (
              <MoverChip key={m.talentId} move={m} talents={talents} />
            ))}
          </ul>
        </section>

        <div className="mt-7 flex justify-center pb-4">
          <button
            type="button"
            onClick={handleDismiss}
            className="rounded-full bg-holo-accent px-6 py-2 text-sm font-semibold text-holo-card shadow-card transition hover:opacity-90 sm:text-base"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
