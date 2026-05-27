import { useState } from "react";
import { patchPrefs } from "../net/api.js";
import { useGame } from "../state/game.js";

export function HelpModal(): JSX.Element | null {
  const { helpOpen, setHelpOpen, prefs, setPrefs, accessToken } = useGame();
  // Local toggle-in-flight state so we can show pending UI without bouncing
  // the whole prefs object back and forth.
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  if (!helpOpen) return null;

  const onTogglePing = async (): Promise<void> => {
    if (!accessToken || saving) return;
    const next = { recapPingMuted: !prefs.recapPingMuted };
    // Optimistic update — the server echoes the persisted state so we
    // re-apply it on success in case anything else has changed.
    setPrefs(next);
    setSaving(true);
    setSaveError(null);
    try {
      const persisted = await patchPrefs(accessToken, next);
      setPrefs(persisted);
    } catch (err) {
      // Roll back on failure so the toggle reflects reality.
      setPrefs({ recapPingMuted: !next.recapPingMuted });
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  // The toggle is logically "show me as a mention chip"; that's the
  // opt-in direction so it matches the default-true intuition. The flag
  // we store is the inverse (recapPingMuted), so the checked state is
  // !recapPingMuted.
  const mentionChipOn = !prefs.recapPingMuted;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => setHelpOpen(false)}
    >
      <div
        className="card max-w-md w-full p-6 text-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">How to play</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={() => setHelpOpen(false)}
            className="rounded-full px-2 text-holo-muted hover:bg-holo-bg"
          >
            ✕
          </button>
        </div>
        <p className="mt-3">
          Guess today's Hololive talent in six tries. After each guess each attribute
          turns:
        </p>
        <ul className="mt-2 space-y-2">
          <li className="flex items-center gap-2">
            <span className="cell-equal w-24 shrink-0">Green</span>
            <span>Exact match.</span>
          </li>
          <li className="flex items-center gap-2">
            <span className="cell-wrong w-24 shrink-0">Red</span>
            <span>No match. ↑ / ↓ point toward the target for birth month.</span>
          </li>
        </ul>
        <p className="mt-3 text-xs text-holo-muted">
          A new puzzle drops at midnight in your timezone. Streaks roll
          over with your local day.
        </p>

        <hr className="my-4 border-holo-muted/20" />

        <h3 className="text-base font-bold">Settings</h3>
        <label className="mt-3 flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={mentionChipOn}
            onChange={() => void onTogglePing()}
            disabled={saving || !accessToken}
            className="mt-1 h-4 w-4 shrink-0 accent-holo-accent"
          />
          <span className="flex-1">
            <span className="font-semibold">Show me as a mention chip in daily recaps</span>
            <span className="mt-1 block text-xs text-holo-muted">
              When off, your display name appears as plain text instead of a clickable
              @mention. Push notifications stay suppressed either way.
            </span>
          </span>
        </label>
        {saveError && (
          <p className="mt-2 text-xs text-holo-bad">Couldn't save: {saveError}</p>
        )}
      </div>
    </div>
  );
}
