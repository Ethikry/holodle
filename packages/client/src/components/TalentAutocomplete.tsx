import { useMemo, useRef, useState } from "react";
import type { TalentSummary } from "@holodle/shared";
import { useGame } from "../state/game.js";

// Stable circular avatar with a gray placeholder fallback. We track failed
// URLs in component state instead of mutating .style.visibility so the layout
// stays predictable across rerenders (avoids the dropdown row reflowing).
function AvatarCircle({ talent }: { talent: TalentSummary }): JSX.Element {
  const [failed, setFailed] = useState(false);
  if (failed || !talent.avatarUrl) {
    return (
      <div
        aria-hidden
        className="h-10 w-10 shrink-0 rounded-full bg-holo-bg ring-1 ring-holo-accent/20"
      />
    );
  }
  return (
    <img
      src={talent.avatarUrl}
      alt=""
      className="h-10 w-10 shrink-0 rounded-full object-cover ring-1 ring-holo-accent/20"
      onError={() => setFailed(true)}
    />
  );
}

export function TalentAutocomplete({
  onSubmit,
  disabled,
}: {
  onSubmit: (talentId: string) => void;
  disabled: boolean;
}): JSX.Element {
  const { talents, history } = useGame();
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  const guessedIds = useMemo(() => new Set(history.map((h) => h.talentId)), [history]);

  const matches = useMemo<TalentSummary[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return talents
      .filter((t) => !guessedIds.has(t.id))
      .filter((t) => t.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [talents, guessedIds, query]);

  function commit(id: string): void {
    onSubmit(id);
    setQuery("");
  }

  // The autocomplete now lives below the guess board (so history stays
  // visible while typing). When the user taps the input we scroll it
  // into view — keeps the input + suggestions in frame on mobile
  // keyboards and on long boards where the input was below the fold.
  // Delayed one tick so the virtual keyboard has time to shrink the
  // viewport before we measure.
  function handleFocus(): void {
    setTimeout(() => {
      wrapRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
  }

  return (
    <div ref={wrapRef} className="mx-4 my-2">
      {/* Suggestions appear ABOVE the input (the input sits at the very
          bottom of the page, so a downward dropdown would land off-
          screen). `flex-col-reverse` would also work, but we keep the
          DOM order matching reading order — list first, input last —
          and let `mb-2` on the list create the gap. */}
      {matches.length > 0 && (
        <ul className="card mb-2 max-h-64 overflow-y-auto divide-y divide-holo-muted/10">
          {matches.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => commit(t.id)}
                className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-holo-bg"
              >
                <AvatarCircle talent={t} />
                <span className="font-medium">{t.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        type="text"
        inputMode="text"
        autoComplete="off"
        placeholder="Type a talent name…"
        disabled={disabled}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={handleFocus}
        className="w-full rounded-2xl border-2 border-holo-accent/30 bg-holo-card px-4 py-3 text-base shadow-card transition focus:border-holo-accent focus:outline-none disabled:opacity-60"
      />
    </div>
  );
}
