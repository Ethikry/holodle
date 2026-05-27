import { useGame } from "../state/game.js";
import { AnswerAvatar } from "./AnswerAvatar.js";

export function ResultPanel(): JSX.Element | null {
  const { status, history, answer, setRecapOpen } = useGame();
  if (status === "playing") return null;

  if (status === "won") {
    const guesses = history.length;
    const name = answer?.name ?? "the talent";
    return (
      <div className="mx-4 my-4 rounded-2xl border-2 border-holo-okBd bg-holo-okBg/40 px-6 py-6 text-center">
        <div className="text-3xl animate-bounce">🎊</div>
        <p className="mt-2 text-xl font-bold text-holo-ok animate-pulseGlow">Yatta! ✨</p>
        {answer && <div className="mt-2"><AnswerAvatar answer={answer} /></div>}
        <p className="mt-2 text-sm">
          You found <span className="font-bold">{name}</span> in {guesses} guess
          {guesses === 1 ? "" : "es"}!
        </p>
        <p className="mt-1 text-xs text-holo-muted">Come back tomorrow for a new talent!</p>
        <button
          type="button"
          onClick={() => setRecapOpen(true)}
          className="mt-3 rounded-full border border-holo-ok px-4 py-1.5 text-xs font-semibold text-holo-ok hover:bg-holo-ok/10"
        >
          View recap
        </button>
      </div>
    );
  }

  // lost
  return (
    <div className="mx-4 my-4 rounded-2xl border-2 border-holo-bad/40 bg-holo-badBg/40 px-6 py-6 text-center">
      <p className="text-xl font-bold text-holo-bad">Better luck tomorrow.</p>
      {answer && (
        <>
          <div className="mt-3"><AnswerAvatar answer={answer} /></div>
          <p className="mt-2 text-sm">
            The talent was <span className="font-bold">{answer.name}</span>.
          </p>
        </>
      )}
      <button
        type="button"
        onClick={() => setRecapOpen(true)}
        className="mt-3 rounded-full border border-holo-bad/60 px-4 py-1.5 text-xs font-semibold text-holo-bad hover:bg-holo-bad/10"
      >
        View recap
      </button>
    </div>
  );
}
