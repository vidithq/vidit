import type { ReactNode } from "react";

import { FILTER_CHIP_ACTIVE, FILTER_CHIP_INACTIVE } from "./styles";

// One selectable rounded chip: the active/inactive colour pair plus a size.
// The bounties status filter and the search type filter copy-pasted the same
// `rounded-full text-…/font-medium…` string with the `active ? … : …` ternary;
// the shape lives here once. `size="md"` (slightly larger) backs the form tag
// pills (see `TagChip`). The map FilterPanel keeps its own denser chip on
// purpose, a separate shape.
const SIZE = {
  sm: "px-2.5 py-1 text-[11px]", // filter / type bars
  md: "px-3 py-1 text-xs", // tag selection in the submit / edit forms
} as const;

export function FilterChip({
  active,
  onClick,
  size = "sm",
  children,
}: {
  active: boolean;
  onClick: () => void;
  size?: keyof typeof SIZE;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${SIZE[size]} rounded-full font-medium transition-colors ${
        active ? FILTER_CHIP_ACTIVE : FILTER_CHIP_INACTIVE
      }`}
    >
      {children}
    </button>
  );
}
