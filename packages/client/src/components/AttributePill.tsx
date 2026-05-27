import type { AttrCell, CellState } from "@holodle/shared";

// Visual variants:
//   - equal   → green
//   - partial → yellow  (only the combined "group" column produces this)
//   - wrong   → red
// The prior directional states ("higher"/"lower") that surfaced arrows
// next to the value have been retired.
function classFor(state: CellState): string {
  if (state === "equal") return "cell-equal";
  if (state === "partial") return "cell-partial";
  return "cell-wrong";
}

export function AttributePill<V extends string | number>({
  cell,
}: {
  cell: AttrCell<V> | null | undefined;
}): JSX.Element {
  // Defensive guard. If the server returned a diff shape that's missing
  // this attribute (e.g. an old-schema row that snuck through migration),
  // render a neutral placeholder instead of dereferencing undefined and
  // throwing "Cannot read properties of undefined (reading 'state')",
  // which would otherwise tear down the whole React tree.
  if (!cell || typeof cell !== "object" || !("state" in cell)) {
    return (
      <span
        className="inline-flex w-full items-center justify-center whitespace-nowrap rounded-xl border-2 border-holo-muted/30 bg-holo-bg px-3 py-2 text-sm font-semibold text-holo-muted"
        title="missing attribute"
      >
        —
      </span>
    );
  }
  const raw = String(cell.value);
  // Hard line breaks come from the server via "\n" — currently only the
  // Generation cell emits these (branch on line 1, gen on line 2). When
  // present, take that as the visual structure and stack the lines so
  // the partial-match colour highlight reads as "this whole pill is half
  // right" rather than mashing branch + gen into one ambiguous string.
  // Multi-group talents (Fubuki: "JP\nGen 1 / GAMERS") still show their
  // " / "-joined gens inside the second line — they don't get a third
  // row.
  if (raw.includes("\n")) {
    const lines = raw.split("\n");
    return (
      <span className={`${classFor(cell.state)} !flex-col !whitespace-normal !leading-tight !text-[10px] sm:!text-xs`}>
        {lines.map((p, i) => (
          <span key={i} className="block">
            {p}
          </span>
        ))}
      </span>
    );
  }
  // Non-newline multi-value cells (Nerissa archetype "Bird / Demon")
  // overflow the single-line pill at mobile widths. Detect the " / "
  // separator the server emits and stack the parts vertically.
  const parts = raw.includes(" / ") ? raw.split(" / ") : null;
  if (parts) {
    return (
      <span className={`${classFor(cell.state)} !flex-col !whitespace-normal !leading-tight !text-[9px] sm:!text-[11px]`}>
        {parts.map((p, i) => (
          <span key={i} className="block">
            {p}
          </span>
        ))}
      </span>
    );
  }
  return <span className={classFor(cell.state)}>{raw}</span>;
}
