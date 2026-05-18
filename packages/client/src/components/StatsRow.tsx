import { useGame } from "../state/game.js";

function StatCard({ value, label }: { value: string | number; label: string }): JSX.Element {
  return (
    <div className="card flex flex-1 flex-col items-center justify-center py-4">
      <span className="text-2xl font-bold text-holo-accent">{value}</span>
      <span className="text-xs font-semibold text-holo-muted">{label}</span>
    </div>
  );
}

export function StatsRow(): JSX.Element {
  const { stats } = useGame();
  return (
    <div className="grid grid-cols-2 gap-3 px-4 sm:grid-cols-4">
      <StatCard value={stats.streak} label="Streak" />
      <StatCard value={stats.best} label="Best" />
      <StatCard value={stats.played} label="Played" />
      <StatCard value={`${Math.round(stats.winRate * 100)}%`} label="Win rate" />
    </div>
  );
}
