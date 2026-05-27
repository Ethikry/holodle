import { useState } from "react";
import { patchPrefs } from "../net/api.js";
import { useGame } from "../state/game.js";
import { THEMES, applyTheme } from "../themes.js";

export function HelpModal(): JSX.Element | null {
  const { helpOpen, setHelpOpen, prefs, setPrefs, accessToken } = useGame();
  // Local in-flight state so we can disable inputs while a PATCH is on
  // the wire without bouncing the whole prefs object.
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  if (!helpOpen) return null;

  // Generic helper: optimistically apply a partial pref update, send the
  // PATCH, roll back on failure. Reused for both the ping toggle and the
  // theme picker so we don't grow two near-identical handlers.
  const updatePrefs = async (patch: { recapPingMuted?: boolean; theme?: string }): Promise<void> => {
    if (!accessToken || saving) return;
    const prev = prefs;
    const next = { ...prefs, ...patch };
    setPrefs(next);
    if (patch.theme && patch.theme !== prev.theme) applyTheme(patch.theme);
    setSaving(true);
    setSaveError(null);
    try {
      const persisted = await patchPrefs(accessToken, patch);
      setPrefs(persisted);
    } catch (err) {
      setPrefs(prev);
      if (patch.theme && patch.theme !== prev.theme) applyTheme(prev.theme);
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const mentionChipOn = !prefs.recapPingMuted;

  return (
    <div
      role="dialog"
      aria-modal="true"
      // Discord's iframe chrome covers ~50px at the top on mobile and a
      // ~70px playback bar at the bottom. We pad the outer wrapper so
      // the modal never tucks behind either, and use overflow-y-auto so
      // tall modals scroll inside the wrapper on short viewports.
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 pt-14 pb-20 sm:items-center sm:pt-6 sm:pb-6"
      onClick={() => setHelpOpen(false)}
    >
      <div
        // max-h + overflow-y-auto on the inner card lets long content
        // (the 12-swatch theme grid) scroll within the modal while the
        // close button stays reachable.
        className="card max-h-full max-w-md w-full overflow-y-auto p-6 text-sm animate-modalEnter"
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
            <span className="cell-partial w-24 shrink-0">Yellow</span>
            <span>Group only: branch or generation matches, but not both.</span>
          </li>
          <li className="flex items-center gap-2">
            <span className="cell-wrong w-24 shrink-0">Red</span>
            <span>No match.</span>
          </li>
        </ul>
        <p className="mt-3 text-xs text-holo-muted">
          A new puzzle drops at midnight in your timezone. Streaks roll
          over with your local day.
        </p>

        <hr className="my-4 border-holo-muted/20" />

        <h3 className="text-base font-bold">Settings</h3>

        {/* Theme picker. Renders one swatch button per registered theme;
            click → optimistically apply + PATCH. The active theme gets a
            ring so it's obvious which one is selected. */}
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-holo-muted">
            Theme
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {THEMES.map((t) => {
              const active = prefs.theme === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => void updatePrefs({ theme: t.id })}
                  disabled={saving || !accessToken}
                  className={`flex items-center gap-2 rounded-lg border px-2 py-2 text-left transition hover:bg-holo-bg ${
                    active
                      ? "border-holo-accent ring-2 ring-holo-accent/40"
                      : "border-holo-muted/20"
                  }`}
                  aria-pressed={active}
                >
                  <span className="flex shrink-0 overflow-hidden rounded-md border border-holo-muted/20">
                    {t.swatch.map((c, i) => (
                      <span
                        key={i}
                        aria-hidden
                        className="h-6 w-3"
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </span>
                  <span className="flex flex-col leading-tight">
                    <span className="text-xs font-semibold">{t.label}</span>
                    {t.attribution && (
                      <span className="text-[10px] text-holo-muted">
                        {t.attribution}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <label className="mt-4 flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={mentionChipOn}
            onChange={() => void updatePrefs({ recapPingMuted: mentionChipOn })}
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
