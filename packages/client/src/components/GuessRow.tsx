import type { GuessDiff, Month, TalentSummary, HeightBucket } from "@holodle/shared";
import { AttributePill } from "./AttributePill.js";

// Short bucket labels: the parenthetical range overflowed the column on
// narrow viewports (Discord mobile) and bled into the Birth Month column.
// The bucket name alone is enough for "did I match", and the cm range
// is documented in the help modal.
const BUCKET_LABEL: Record<HeightBucket, string> = {
  Smol: "Smol",
  Med: "Med",
  Tall: "Tall",
};

// Three-letter month abbreviations. The Birth Month cell was 9 chars wide
// ("September", "December"), which clipped to "Sept…" / "Dec…" in the ~50px
// mobile column. The full month name is visible in the help modal; the
// abbreviation is enough at-a-glance and matches the directional arrow.
const MONTH_ABBR: Record<Month, string> = {
  January: "Jan",
  February: "Feb",
  March: "Mar",
  April: "Apr",
  May: "May",
  June: "Jun",
  July: "Jul",
  August: "Aug",
  September: "Sep",
  October: "Oct",
  November: "Nov",
  December: "Dec",
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
      className="grid grid-cols-[48px_repeat(6,minmax(0,1fr))] items-center gap-1 sm:grid-cols-[72px_repeat(6,minmax(0,1fr))] sm:gap-2"
    >
      <div role="cell" className="flex items-center justify-center">
        <div className="card flex h-10 w-10 items-center justify-center overflow-hidden border border-holo-accent/30 sm:h-14 sm:w-14">
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
        <AttributePill cell={{ ...diff.birthMonth, value: MONTH_ABBR[diff.birthMonth.value] }} />
      </div>
    </div>
  );
}
