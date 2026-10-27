"use client";

import { useState, type ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";

import { ActiveFilterPills, type ActiveFilter } from "@/components/ui/ActiveFilterPills";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { MediaOverlay } from "@/components/ui/MediaLightbox";

/**
 * The row above a filtered list below `lg`, where the filter rail (`PageWithRail narrow="hidden"`)
 * is gone: the entry to the rail's panel and the active-filter pills. From `lg` up the row hides,
 * and `<FilterRail>` carries the pills at the head of the rail. The "Filters (N)" button opens the
 * panel full screen on a draft, so the list refetches once, on Apply. Clear empties the draft;
 * closing without Apply drops it.
 */
export function FilterBar<S>({
  value,
  empty,
  count,
  pills,
  onClearAll,
  onApply,
  renderPanel,
}: {
  value: S;
  /** The draft Clear resets to. */
  empty: S;
  /** Active filters in `value`, shown on the button. */
  count: number;
  pills: ActiveFilter[];
  onClearAll: () => void;
  onApply: (next: S) => void;
  renderPanel: (draft: S, setDraft: (next: S) => void) => ReactNode;
}) {
  const [draft, setDraft] = useState<{ value: S } | null>(null);
  const close = () => setDraft(null);

  return (
    <div className="flex flex-wrap items-center gap-2 lg:hidden">
      <Button
        variant="secondary"
        aria-haspopup="dialog"
        onClick={() => setDraft({ value })}
      >
        <SlidersHorizontal size={14} />
        {count > 0 ? `Filters (${count})` : "Filters"}
      </Button>
      <ActiveFilterPills filters={pills} onClearAll={onClearAll} />
      {draft && (
        <MediaOverlay variant="dialog" label="Filters" onClose={close}>
          <Card className="flex min-h-[calc(100dvh-3rem)] w-[calc(100vw-3rem)] flex-col">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-neutral-100">Filters</h2>
              <Button variant="ghost" data-overlay-close="" onClick={close}>
                Cancel
              </Button>
            </div>
            <div className="grow">
              {renderPanel(draft.value, (next) => setDraft({ value: next }))}
            </div>
            <div className="sticky bottom-0 flex justify-end gap-2 bg-neutral-900 pt-2">
              <Button variant="ghost" onClick={() => setDraft({ value: empty })}>
                Clear
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  onApply(draft.value);
                  close();
                }}
              >
                Apply
              </Button>
            </div>
          </Card>
        </MediaOverlay>
      )}
    </div>
  );
}
