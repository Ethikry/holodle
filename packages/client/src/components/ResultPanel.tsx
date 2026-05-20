import { useGame } from "../state/game.js";

export function ResultPanel(): JSX.Element | null {
  const { status, history, answer } = useGame();
  if (status === "playing") return null;

  if (status === "won") {
    const guesses = history.length;
    const name = answer?.name ?? "the talent";
    return (
      <div className="mx-4 my-4 rounded-2xl border-2 border-holo-okBd bg-holo-okBg/40 px-6 py-6 text-center">
        <div className="text-3xl">🎊</div>
        <p className="mt-2 text-xl font-bold text-holo-ok">Yatta! ✨</p>
        <p className="mt-1 text-sm">
          You found <span className="font-bold">{name}</span> in {guesses} guess
          {guesses === 1 ? "" : "es"}!
        </p>
        <p className="mt-1 text-xs text-holo-muted">Come back tomorrow for a new talent!</p>
      </div>
    );
  }

  // lost
  return (
    <div className="mx-4 my-4 rounded-2xl border-2 border-holo-bad/40 bg-holo-badBg/40 px-6 py-6 text-center">
      <p className="text-xl font-bold text-holo-bad">Better luck tomorrow.</p>
      {answer && (
        <p className="mt-1 text-sm">
          The talent was <span className="font-bold">{answer.name}</span>.
        </p>
      )}
    </div>
  );
}
