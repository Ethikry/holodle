import type { TalentSummary } from "@holodle/shared";

// Circular reveal of the puzzle's answer talent. Shown after settle in
// both the inline ResultPanel and the full-screen RecapScreen overlay.
// Factored out so both surfaces stay visually consistent.
export function AnswerAvatar({
  answer,
  size = 80,
}: {
  answer: TalentSummary;
  size?: number;
}): JSX.Element {
  const dim = `${size}px`;
  return (
    <div className="flex justify-center">
      <div
        className="card flex items-center justify-center overflow-hidden border border-holo-accent/30"
        style={{ width: dim, height: dim }}
      >
        <img
          src={answer.avatarUrl}
          alt={answer.name}
          className="h-full w-full object-cover"
        />
      </div>
    </div>
  );
}
