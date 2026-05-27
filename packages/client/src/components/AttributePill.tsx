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
  // Multi-value cells (Fubuki "JP Gen 1 / GAMERS", Nerissa "Bird / Demon")
  // overflow the single-line pill at mobile widths. Detect the " / "
  // separator the server emits and stack the parts vertically with
  // tighter type so each label stays visible.
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
