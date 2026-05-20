import { useGame } from "../state/game.js";

function StatCard({ value, label }: { value: string | number; label: string }): JSX.Element {
  return (
    <div className="card flex flex-1 flex-col items-center justify-center py-1.5 sm:py-4">
      <span className="text-lg font-bold text-holo-accent sm:text-2xl">{value}</span>
      <span className="text-[10px] font-semibold text-holo-muted sm:text-xs">{label}</span>
    </div>
  );
}

// Single horizontal row on mobile (4 narrow cards) instead of a 2x2 grid —
// the 2x2 took ~50% of viewport height before any guesses appeared. On
// sm+ we keep the original 4-column grid.
export function StatsRow(): JSX.Element {
  const { stats } = useGame();
  return (
    <div className="grid grid-cols-4 gap-1.5 px-2 sm:gap-3 sm:px-4">
      <StatCard value={stats.streak} label="Streak" />
      <StatCard value={stats.best} label="Best" />
      <StatCard value={stats.played} label="Played" />
      <StatCard value={`${Math.round(stats.winRate * 100)}%`} label="Win rate" />
    </div>
  );
}
