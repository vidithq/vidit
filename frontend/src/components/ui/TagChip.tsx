import type { Tag } from "@/types";
import { FilterChip } from "@/components/ui/FilterChip";

// Selectable tag pill for the submit / edit forms: the shared `FilterChip` at
// its `md` size, keyed by a tag. Orange when active per the palette rule
// (clickable ⇒ orange), neutral when inactive.
export function TagChip({
  tag,
  active,
  onClick,
}: {
  tag: Tag;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <FilterChip active={active} onClick={onClick} size="md">
      {tag.name}
    </FilterChip>
  );
}
