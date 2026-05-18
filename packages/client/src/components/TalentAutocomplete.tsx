import { useMemo, useState } from "react";
import type { TalentSummary } from "@holodle/shared";
import { useGame } from "../state/game.js";

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
        className="w-full rounded-2xl border border-holo-muted/20 bg-white px-4 py-3 text-base shadow-card focus:border-holo-accent focus:outline-none disabled:opacity-60"
      />
      {matches.length > 0 && (
        <ul className="mt-2 max-h-64 overflow-y-auto rounded-2xl bg-white shadow-card">
          {matches.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => commit(t.id)}
                className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-holo-bg"
              >
                <img
                  src={t.avatarUrl}
                  alt=""
                  className="h-8 w-8 rounded-full object-cover"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
                  }}
                />
                <span className="font-medium">{t.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
