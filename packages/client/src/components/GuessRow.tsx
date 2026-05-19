import type { GuessDiff, TalentSummary, HeightBucket } from "@holodle/shared";
import { AttributePill } from "./AttributePill.js";

const BUCKET_LABEL: Record<HeightBucket, string> = {
  Smol: "Smol (≤150)",
  Med: "Med (151–160)",
  Tall: "Tall (>160)",
};

export function GuessRow({
  diff,
  talents,
}: {
  diff: GuessDiff;
  talents: TalentSummary[];
}): JSX.Element {
  const talent = talents.find((t) => t.id === diff.talentId);
  return (
    <tr className="text-center">
      <td className="px-2 py-2">
        <div className="card mx-auto flex h-12 w-12 items-center justify-center overflow-hidden">
          {talent?.avatarUrl ? (
            <img src={talent.avatarUrl} alt={talent.name} className="h-full w-full object-cover" />
          ) : (
            <span className="text-xs text-holo-muted">?</span>
          )}
        </div>
      </td>
      <td className="px-2 py-2">
        <AttributePill cell={diff.generation} />
      </td>
      <td className="px-2 py-2">
        <AttributePill cell={diff.branch} />
      </td>
      <td className="px-2 py-2">
        <AttributePill cell={diff.debutYear} />
      </td>
      <td className="px-2 py-2">
        <AttributePill cell={diff.archetype} />
      </td>
      <td className="px-2 py-2">
        <AttributePill cell={{ ...diff.height, value: BUCKET_LABEL[diff.height.value] }} />
      </td>
      <td className="px-2 py-2">
        <AttributePill cell={diff.birthMonth} />
      </td>
    </tr>
  );
}
