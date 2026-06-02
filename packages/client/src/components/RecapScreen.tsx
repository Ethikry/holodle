import type { BoardRow, CellState, GameStatus, PlayerSnapshot, UserStats } from "@holodle/shared";
import { MAX_GUESSES } from "@holodle/shared";
import { useGame } from "../state/game.js";
import { AnswerAvatar } from "./AnswerAvatar.js";

// Full-screen post-completion overlay. Mirrors Wordle's stats screen:
// a "Back to puzzle" button up top, a hero block (celebration + answer
// reveal), and a tile grid of every player in the channel showing their
// mini board. Auto-opens when the user transitions playing → won/lost
// (handled in state/game.ts:appendGuess); re-openable via the "View
// recap" button on the inline ResultPanel.
//
// Reuses the existing PlayerSnapshot data already broadcast over the
// socket — no new traffic.

const COLS = 6;

function cellClass(state: CellState | "empty"): string {
  switch (state) {
    case "equal":
      return "bg-holo-ok border-holo-okBd";
    case "partial":
      // Solid yellow block (like the green) so a partial reads clearly.
      return "bg-amber-400 border-amber-500";
    case "wrong":
      // Muted/desaturated red so the green "correct" cells draw the eye.
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

function statusLabel(snapshot: PlayerSnapshot): string {
  if (snapshot.status === "won") return `${snapshot.guessesUsed}/${MAX_GUESSES}`;
  if (snapshot.status === "lost") return `X/${MAX_GUESSES}`;
  return `${snapshot.guessesUsed}/${MAX_GUESSES}…`;
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
    <div className="grid grid-cols-6 gap-[3px]">
      {cells.map((state, i) => (
        <div
          key={i}
          aria-hidden
          className={`aspect-square rounded-[3px] border-2 ${cellClass(state)}`}
        />
      ))}
    </div>
  );
}

// Same sort order as the sidebar — self first, then completed
// (won → lost) by ascending guess count, then in-progress by descending
// guess count.
function rank(p: PlayerSnapshot): number {
  if (p.status === "won") return 1;
  if (p.status === "lost") return 2;
  return 3;
}

function PlayerTile({
  snapshot,
  isSelf,
  staggerIndex,
}: {
  snapshot: PlayerSnapshot;
  isSelf: boolean;
  staggerIndex: number;
}): JSX.Element {
  return (
    <div
      className={`card flex flex-col items-center gap-2 border animate-tileEnter ${
        isSelf ? "border-holo-accent/60" : "border-holo-muted/20"
      } p-3`}
      style={{ animationDelay: `${staggerIndex * 50}ms` }}
    >
      <div className="relative">
        {snapshot.avatarUrl ? (
          <img
            src={snapshot.avatarUrl}
            alt=""
            className="h-14 w-14 rounded-full border border-holo-muted/20 object-cover"
          />
        ) : (
          <div className="h-14 w-14 rounded-full border border-holo-muted/20 bg-holo-bg" />
        )}
        <span
          aria-label={snapshot.status}
          className={`absolute bottom-0 right-0 inline-block h-3 w-3 rounded-full border-2 border-holo-card ${statusDot(snapshot.status)}`}
        />
      </div>
      <span className="w-full truncate text-center text-xs font-medium leading-tight">
        {snapshot.displayName}
        {isSelf && (
          <span className="ml-1 text-[10px] font-normal text-holo-muted">(you)</span>
        )}
      </span>
      <span className="text-[10px] uppercase tracking-wider text-holo-muted">
        {statusLabel(snapshot)}
      </span>
      <div className="w-full max-w-[120px]">
        <MiniBoard board={snapshot.board} />
      </div>
    </div>
  );
}

// Wordle-style lifetime guess-count histogram: a bar per winning guess
// count (1-6) plus a flat "X" bar for losses. The just-finished game's bar
// is highlighted so the player can see where today landed.
function GuessDistribution({
  dist,
  highlightWin,
  highlightLoss,
}: {
  dist: UserStats["guessDistribution"];
  highlightWin: number | null;
  highlightLoss: boolean;
}): JSX.Element {
  const wins = dist?.wins ?? {};
  const losses = dist?.losses ?? 0;
  const rows: Array<{ label: string; count: number; highlight: boolean; loss: boolean }> = [];
  for (let n = 1; n <= MAX_GUESSES; n++) {
    rows.push({ label: String(n), count: wins[n] ?? 0, highlight: highlightWin === n, loss: false });
  }
  rows.push({ label: "X", count: losses, highlight: highlightLoss, loss: true });
  const max = Math.max(1, ...rows.map((r) => r.count));

  return (
    <div className="mt-2 space-y-1.5">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2">
          <span className="w-4 text-right text-xs font-semibold tabular-nums text-holo-muted">
            {r.label}
          </span>
          <div className="flex-1">
            <div
              className={`flex h-5 min-w-[1.5rem] items-center justify-end rounded px-1.5 text-[11px] font-bold text-white ${
                r.highlight ? "bg-holo-accent" : r.loss ? "bg-holo-bad/55" : "bg-holo-ok"
              }`}
              style={{ width: `${(r.count / max) * 100}%` }}
            >
              {r.count}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function RecapScreen(): JSX.Element | null {
  const {
    recapOpen,
    setRecapOpen,
    status,
    history,
    answer,
    players,
    selfUserId,
    stats,
  } = useGame();

  if (!recapOpen) return null;

  const sorted = Array.from(players.values()).sort((a, b) => {
    if (a.userId === selfUserId) return -1;
    if (b.userId === selfUserId) return 1;
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (a.status === "playing") return b.guessesUsed - a.guessesUsed;
    return a.guessesUsed - b.guessesUsed;
  });

  // Hero text mirrors the inline ResultPanel so users have a consistent
  // win/loss copy line on either surface.
  const won = status === "won";
  const guesses = history.length;
  const heroTitle = won ? "Yatta! ✨" : "Better luck tomorrow.";
  const heroTitleClass = won ? "text-holo-ok" : "text-holo-bad";
  const heroSubtitle = won
    ? answer
      ? `You found ${answer.name} in ${guesses} guess${guesses === 1 ? "" : "es"}!`
      : null
    : answer
      ? `The talent was ${answer.name}.`
      : null;

  const winRatePct = Math.round(stats.winRate * 100);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Daily recap"
      className="fixed inset-0 z-40 overflow-y-auto bg-holo-bg/95 backdrop-blur-sm animate-overlayEnter"
    >
      {/* pt-14 matches Header.tsx — Discord mobile overlays ~48px of
          its own chrome at the top of the iframe, so anything in the
          first ~48px (notably the "Back to puzzle" button) gets
          clipped. Desktop gets the smaller pt-4 since there's no
          overlay there. */}
      <div className="mx-auto flex min-h-full max-w-3xl flex-col px-4 pt-14 pb-4 sm:pt-4">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setRecapOpen(false)}
            className="rounded-full border border-holo-muted/30 px-3 py-1 text-sm text-holo-muted hover:bg-holo-card"
          >
            ← Back to puzzle
          </button>
        </div>

        <div className="mt-4 rounded-2xl border-2 border-holo-accent/50 bg-holo-accent/10 px-6 py-6 text-center">
          {won && <div className="text-3xl animate-bounce">🎊</div>}
          <p
            className={`mt-1 text-2xl font-bold ${heroTitleClass} ${
              won ? "animate-pulseGlow" : ""
            }`}
          >
            {heroTitle}
          </p>
          {answer && (
            <div className="mt-3">
              <AnswerAvatar answer={answer} size={96} />
            </div>
          )}
          {heroSubtitle && <p className="mt-2 text-sm">{heroSubtitle}</p>}
        </div>

        {sorted.length > 0 && (
          <section className="mt-6">
            <h3 className="px-1 text-xs font-semibold uppercase tracking-wider text-holo-muted">
              Everyone's boards
            </h3>
            <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {sorted.map((p, idx) => (
                <PlayerTile
                  key={p.userId}
                  snapshot={p}
                  isSelf={p.userId === selfUserId}
                  staggerIndex={idx}
                />
              ))}
            </div>
          </section>
        )}

        <section className="mt-6">
          <h3 className="px-1 text-xs font-semibold uppercase tracking-wider text-holo-muted">
            Your stats
          </h3>
          <div className="mt-2 grid grid-cols-3 gap-3 text-center">
            <div className="card p-3">
              <p className="text-xl font-bold">{winRatePct}%</p>
              <p className="text-[10px] uppercase tracking-wider text-holo-muted">Win Rate</p>
            </div>
            <div className="card p-3">
              <p className="text-xl font-bold">{stats.streak}</p>
              <p className="text-[10px] uppercase tracking-wider text-holo-muted">Current Streak</p>
            </div>
            <div className="card p-3">
              <p className="text-xl font-bold">{stats.best}</p>
              <p className="text-[10px] uppercase tracking-wider text-holo-muted">Best Streak</p>
            </div>
          </div>
          <div className="card mt-3 p-3">
            <p className="text-[10px] uppercase tracking-wider text-holo-muted">Guess Distribution</p>
            <GuessDistribution
              dist={stats.guessDistribution}
              highlightWin={won ? Math.min(Math.max(guesses, 1), MAX_GUESSES) : null}
              highlightLoss={status === "lost"}
            />
          </div>
        </section>

        <p className="mt-6 pb-6 text-center text-xs text-holo-muted">
          A new puzzle drops at midnight in your timezone.
        </p>
      </div>
    </div>
  );
}
