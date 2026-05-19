import type { GuessDiff, TalentSummary, HeightBucket } from "@holodle/shared";
import { AttributePill } from "./AttributePill.js";

const BUCKET_LABEL: Record<HeightBucket, string> = {
  Smol: "Smol (≤150)",
  Med: "Med (151–160)",
  Tall: "Tall (>160)",
};

// One row of the guess grid. 7 columns: avatar + 6 attribute cells.
// The CSS-grid template is defined on the parent GuessGrid so header labels
// line up with the cells below.
export function GuessRow({
  diff,
  talents,
}: {
  diff: GuessDiff;
  talents: TalentSummary[];
}): JSX.Element {
  const talent = talents.find((t) => t.id === diff.talentId);
  return (
    <div
      role="row"
      className="grid grid-cols-[72px_repeat(6,minmax(0,1fr))] items-center gap-2"
    >
      <div role="cell" className="flex items-center justify-center">
        <div className="card flex h-14 w-14 items-center justify-center overflow-hidden border border-holo-accent/30">
          {talent?.avatarUrl ? (
            <img
              src={talent.avatarUrl}
              alt={talent.name}
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="text-xs text-holo-muted">?</span>
          )}
        </div>
      </div>
      <div role="cell">
        <AttributePill cell={diff.generation} />
      </div>
      <div role="cell">
        <AttributePill cell={diff.branch} />
      </div>
      <div role="cell">
        <AttributePill cell={diff.debutYear} />
      </div>
      <div role="cell">
        <AttributePill cell={diff.archetype} />
      </div>
      <div role="cell">
        <AttributePill cell={{ ...diff.height, value: BUCKET_LABEL[diff.height.value] }} />
      </div>
      <div role="cell">
        <AttributePill cell={diff.birthMonth} />
      </div>
    </div>
  );
}
