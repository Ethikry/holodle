import type { GuessDiff, GameStatus, PlayerSnapshot, CellState } from "@holodle/shared";
import { MAX_GUESSES } from "@holodle/shared";
import { useGame } from "../state/game.js";

// Left-rail sidebar listing every other player in the room. Each entry is a
// circular avatar + a mini 6×6 guess grid mirroring their progress. The grid
// uses the same color states as the embed image so the iframe and chat
// follow-up stay visually consistent.

const COLS = 6;

function cellClass(state: CellState | "empty"): string {
  switch (state) {
    case "equal":
      return "bg-holo-okBg border-holo-okBd";
    case "higher":
    case "lower":
      return "bg-amber-300/60 border-amber-500/60";
    case "wrong":
      return "bg-holo-badBg/50 border-holo-badBd/50";
    default:
      return "bg-holo-bg border-holo-muted/20";
  }
}

function statusDot(status: GameStatus): string {
  if (status === "won") return "bg-holo-ok";
  if (status === "lost") return "bg-holo-bad";
  return "bg-holo-accent";
}

function MiniBoard({ history }: { history: GuessDiff[] }): JSX.Element {
  const cells: Array<CellState | "empty"> = [];
  for (let row = 0; row < MAX_GUESSES; row++) {
    const diff = history[row];
    if (!diff) {
      for (let i = 0; i < COLS; i++) cells.push("empty");
      continue;
    }
    cells.push(
      diff.generation.state,
      diff.branch.state,
      diff.debutYear.state,
      diff.archetype.state,
      diff.height.state,
      diff.birthMonth.state,
    );
  }
  return (
    <div className="grid grid-cols-6 gap-[2px]">
      {cells.map((state, i) => (
        <div
          key={i}
          aria-hidden
          className={`aspect-square rounded-[2px] border ${cellClass(state)}`}
        />
      ))}
    </div>
  );
}

export function PlayerBoardSidebar(): JSX.Element | null {
  const { players, selfUserId } = useGame();
  const others = Array.from(players.values()).filter((p) => p.userId !== selfUserId);
  if (others.length === 0) return null;
  return (
    <aside className="w-[140px] shrink-0 border-r border-holo-muted/20 bg-holo-card/40 px-2 py-3">
      <h2 className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-holo-muted">
        In this channel
      </h2>
      <ul className="space-y-3">
        {others.map((p) => (
          <PlayerCard key={p.userId} snapshot={p} />
        ))}
      </ul>
    </aside>
  );
}

function PlayerCard({ snapshot }: { snapshot: PlayerSnapshot }): JSX.Element {
  return (
    <li className="flex flex-col items-center gap-1">
      <div className="relative">
        {snapshot.avatarUrl ? (
          <img
            src={snapshot.avatarUrl}
            alt=""
            className="h-12 w-12 rounded-full border border-holo-muted/20 object-cover"
          />
        ) : (
          <div className="h-12 w-12 rounded-full border border-holo-muted/20 bg-holo-bg" aria-hidden />
        )}
        <span
          aria-label={snapshot.status}
          className={`absolute bottom-0 right-0 inline-block h-3 w-3 rounded-full border-2 border-holo-card ${statusDot(snapshot.status)}`}
        />
      </div>
      <span className="w-full truncate text-center text-[11px] font-medium leading-tight">
        {snapshot.displayName}
      </span>
      <MiniBoard history={snapshot.history} />
    </li>
  );
}
