import type { ReactNode } from "react";

import { FILTER_CHIP_ACTIVE, FILTER_CHIP_INACTIVE } from "./styles";

// One filter / type chip: the rounded-pill shape plus the active/inactive colour
// pair. The bounties status filter and the search type filter copy-pasted the
// same `px-2.5 py-1 rounded-full text-[11px] font-medium…` string with the
// `active ? FILTER_CHIP_ACTIVE : FILTER_CHIP_INACTIVE` ternary; the shape lives
// here once. (The map FilterPanel keeps its own denser chip, a separate shape.)
export function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
        active ? FILTER_CHIP_ACTIVE : FILTER_CHIP_INACTIVE
      }`}
    >
      {children}
    </button>
  );
}
