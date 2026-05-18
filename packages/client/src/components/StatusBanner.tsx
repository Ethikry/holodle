import { useGame } from "../state/game.js";

export function StatusBanner(): JSX.Element {
  const { status, history, maxGuesses } = useGame();
  let text: string;
  let dotClass: string;
  if (status === "won") {
    text = "You found them! 🎉";
    dotClass = "bg-holo-ok";
  } else if (status === "lost") {
    text = "Better luck tomorrow.";
    dotClass = "bg-holo-bad";
  } else {
    const remaining = Math.max(0, maxGuesses - history.length);
    text = `${remaining}/${maxGuesses} guesses left`;
    dotClass = "bg-holo-accent";
  }
  return (
    <div className="flex justify-center pb-4">
      <div className="card flex items-center gap-2 px-4 py-2 text-sm font-semibold">
        <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${dotClass}`} />
        <span>{text}</span>
      </div>
    </div>
  );
}
