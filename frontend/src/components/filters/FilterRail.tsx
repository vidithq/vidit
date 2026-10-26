import type { ReactNode } from "react";

import { ActiveFilterPills, type ActiveFilter } from "@/components/ui/ActiveFilterPills";
import { AUTHOR_PILL_KEY, type EventFilterSectionName } from "./EventFilterSections";

/**
 * A list page's filter rail: the active-filter pills, then the panel, as the map's filter overlay
 * stacks them. It pairs with `<FilterBar>`, which carries the same pills below `lg`, where the
 * rail is gone. The author pill stays out of the rail when the panel offers the Author section
 * (`sections`, as the panel takes it; all of them when unset), which already names the analyst.
 */
export function FilterRail({
  pills,
  onClearAll,
  sections,
  children,
}: {
  pills: ActiveFilter[];
  onClearAll: () => void;
  sections?: ReadonlyArray<EventFilterSectionName>;
  /** The filter panel. */
  children: ReactNode;
}) {
  const authorShown = !sections || sections.includes("author");
  return (
    <div className="space-y-3">
      <ActiveFilterPills
        filters={authorShown ? pills.filter((pill) => pill.key !== AUTHOR_PILL_KEY) : pills}
        onClearAll={onClearAll}
      />
      {children}
    </div>
  );
}
