import type { AttrCell, CellState } from "@holodle/shared";

function classFor(state: CellState): string {
  switch (state) {
    case "equal":
      return "pill-equal";
    case "near":
      return "pill-near";
    case "higher":
    case "lower":
    case "wrong":
      return "pill-wrong";
  }
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
