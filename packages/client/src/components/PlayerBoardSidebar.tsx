import type { BoardRow, CellState, GameStatus, PlayerSnapshot } from "@holodle/shared";
import { MAX_GUESSES } from "@holodle/shared";
import { useGame } from "../state/game.js";

// Left-rail sidebar listing every player in this channel — self pinned
// first, then everyone else (completed-today users loaded from the DB on
// connect plus anyone currently connected). Each entry is a circular avatar
// + a mini 6x6 guess grid mirroring their progress. The grid renders only
// CellState colors; the GuessDiff values themselves are never broadcast, so
// nobody sees what talents anyone else guessed.

const COLS = 6; // Set to 6 to stay aligned with shared BOARD_COLUMNS

function cellClass(state: CellState | "empty"): string {
  switch (state) {
    case "equal":
      return "bg-holo-ok border-holo-okBd";
    case "partial":
      return "bg-amber-300/70 border-amber-500/70";
    case "wrong":
      // Muted/desaturated so the green "correct" cells draw the eye (bug 6).
      return "bg-holo-bad/45 border-holo-badBd/70";
    default:
      // No-guess blocks fill with the background so they read as empty.
      return "bg-holo-bg border-holo-muted/20";
  }
}

function statusDot(status: GameStatus): string {
  if (status === "won") return "bg-holo-ok";
  if (status === "lost") return "bg-holo-bad";
  return "bg-holo-accent";
}

function MiniBoard({ board }: { board: BoardRow[] }): JSX.Element {
  const cells: Array<CellState | "empty"> = [];
  for (let row = 0; row < MAX_GUESSES; row++) {
    const r = board[row];
    for (let col = 0; col < COLS; col++) {
      cells.push(r?.[col] ?? "empty");
    }
  }
  return (
    <div className="grid grid-cols-6 gap-[2px]"> {/* Changed to grid-cols-6 */}
      {cells.map((state, i) => (
        <div
          key={i}
          aria-hidden
          className={`aspect-square rounded-[2px] border-2 ${cellClass(state)}`}
        />
      ))}
    </div>
  );
}

// Self first, then completed (won → lost) by guess count ascending, then
// in-progress by guess count descending (furthest along first).
function rank(p: PlayerSnapshot): number {
  if (p.status === "won") return 1;
  if (p.status === "lost") return 2;
  return 3;
}

export function PlayerBoardSidebar(): JSX.Element | null {
  const { players, selfUserId } = useGame();
  if (players.size === 0) return null;
  const sorted = Array.from(players.values()).sort((a, b) => {
    if (a.userId === selfUserId) return -1;
    if (b.userId === selfUserId) return 1;
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (a.status === "playing") return b.guessesUsed - a.guessesUsed;
    return a.guessesUsed - b.guessesUsed;
  });
  return (
    <aside className="hidden w-[160px] shrink-0 border-r border-holo-muted/10 bg-holo-card/30 px-2 py-3 backdrop-blur-sm sm:block">
      <h2 className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-holo-muted">
        In this channel
      </h2>
      <ul className="space-y-3">
        {sorted.map((p) => (
          <PlayerCard
            key={p.userId}
            snapshot={p}
            isSelf={p.userId === selfUserId}
          />
        ))}
      </ul>
    </aside>
  );
}

function PlayerCard({
  snapshot,
  isSelf,
}: {
  snapshot: PlayerSnapshot;
  isSelf: boolean;
}): JSX.Element {
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
          <div
            className="h-12 w-12 rounded-full border border-holo-muted/20 bg-holo-bg"
            aria-hidden
          />
        )}
        <span
          aria-label={snapshot.status}
          className={`absolute bottom-0 right-0 inline-block h-3 w-3 rounded-full border-2 border-holo-card ${statusDot(snapshot.status)}`}
        />
      </div>
      <span className="w-full truncate text-center text-[11px] font-medium leading-tight">
        {snapshot.displayName}
        {isSelf && (
          <span className="ml-1 text-[9px] font-normal text-holo-muted">(you)</span>
        )}
      </span>
      <MiniBoard board={snapshot.board} />
    </li>
  );
}