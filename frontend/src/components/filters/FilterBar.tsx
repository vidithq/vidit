"use client";

import { useState, type ReactNode } from "react";

import { ActiveFilterPills, type ActiveFilter } from "@/components/ui/ActiveFilterPills";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { MediaOverlay } from "@/components/ui/MediaLightbox";

/**
 * The row above a filtered list below `lg`, where the filter rail (`PageWithRail narrow="hidden"`)
 * is gone: the entry to the rail's panel and the active-filter pills. From `lg` up the row hides,
 * and `<FilterRail>` carries the pills at the head of the rail. The "Filters (N)" button opens the
 * panel full screen. The panel applies each change at once, as the rail and the map's panel do:
 * Clear empties the filters, and Done closes the dialog.
 */
export function FilterBar({
  count,
  pills,
  onClearAll,
  children,
}: {
  /** Active filters, shown on the button. */
  count: number;
  pills: ActiveFilter[];
  onClearAll: () => void;
  /** The filter panel, bound to the applied filters. */
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <div className="flex flex-wrap items-center gap-2 lg:hidden">
      <Button
        action="filter"
        variant="secondary"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        {count > 0 ? `Filters (${count})` : "Filters"}
      </Button>
      <ActiveFilterPills filters={pills} onClearAll={onClearAll} />
      {open && (
        <MediaOverlay variant="dialog" label="Filters" onClose={close}>
          <Card className="flex min-h-[calc(100dvh-3rem)] w-[calc(100vw-3rem)] flex-col">
            <h2 className="text-base font-semibold text-neutral-100">Filters</h2>
            <div className="grow">{children}</div>
            <div className="sticky bottom-0 flex justify-end gap-2 bg-neutral-900 pt-2">
              <Button action="clear" variant="ghost" disabled={count === 0} onClick={onClearAll}>
                Clear
              </Button>
              <Button action="accept" variant="primary" data-overlay-close="" onClick={close}>
                Done
              </Button>
            </div>
          </Card>
        </MediaOverlay>
      )}
    </div>
  );
}
