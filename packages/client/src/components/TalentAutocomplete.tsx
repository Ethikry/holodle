import { useMemo, useState } from "react";
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

  return (
    <div className="mx-4 my-2">
      <input
        type="text"
        inputMode="text"
        autoComplete="off"
        placeholder="Type a talent name…"
        disabled={disabled}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full rounded-2xl border-2 border-holo-accent/30 bg-white px-4 py-3 text-base shadow-card transition focus:border-holo-accent focus:outline-none disabled:opacity-60"
      />
      {matches.length > 0 && (
        <ul className="card mt-2 max-h-64 overflow-y-auto divide-y divide-holo-muted/10">
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
    </div>
  );
}
