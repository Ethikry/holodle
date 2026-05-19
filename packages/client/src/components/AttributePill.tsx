import type { AttrCell, CellState } from "@holodle/shared";

// Visual variants: equal (green) or wrong (red). The "wrong" variant absorbs
// the directional year states ("higher" / "lower") which surface as an arrow
// next to the value rather than a separate color.
function classFor(state: CellState): string {
  return state === "equal" ? "cell-equal" : "cell-wrong";
}

function arrowFor(state: CellState): string | null {
  if (state === "higher") return "↑";
  if (state === "lower") return "↓";
  return null;
}

export function AttributePill<V extends string | number>({
  cell,
}: {
  cell: AttrCell<V>;
}): JSX.Element {
  const arrow = arrowFor(cell.state);
  return (
    <span className={classFor(cell.state)}>
      {String(cell.value)}
      {arrow && <span className="ml-1">{arrow}</span>}
    </span>
  );
}
