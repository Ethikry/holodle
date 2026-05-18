import { useGame } from "../state/game.js";
import type { GameStatus } from "@holodle/shared";

function dotClass(status: GameStatus): string {
  if (status === "won") return "bg-holo-ok";
  if (status === "lost") return "bg-holo-bad";
  return "bg-holo-accent";
}

export function PlayerList(): JSX.Element | null {
  const { players, selfUserId } = useGame();
  const others = Array.from(players.values()).filter((p) => p.userId !== selfUserId);
  if (others.length === 0) return null;
  return (
    <section className="mx-4 my-4">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-holo-muted">
        Other players
      </h2>
      <ul className="card divide-y divide-holo-muted/10">
        {others.map((p) => (
          <li key={p.userId} className="flex items-center gap-3 px-3 py-2">
            {p.avatarUrl ? (
              <img src={p.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
            ) : (
              <div className="h-8 w-8 rounded-full bg-holo-bg" aria-hidden />
            )}
            <span className="flex-1 truncate font-medium">{p.displayName}</span>
            <span className="text-xs text-holo-muted">{p.guessesUsed}/6</span>
            <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${dotClass(p.status)}`} />
          </li>
        ))}
      </ul>
    </section>
  );
}
