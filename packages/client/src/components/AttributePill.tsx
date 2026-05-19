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
  const arrow = arrowFor(cell.state);
  return (
    <span className={classFor(cell.state)}>
      {String(cell.value)}
      {arrow && <span className="ml-1">{arrow}</span>}
    </span>
  );
}
