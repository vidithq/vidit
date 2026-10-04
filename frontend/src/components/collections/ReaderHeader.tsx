"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/Button";

/** The panel's top-edge fill. Decorative: `N of M` is written out below. */
function ProgressStrip({ step, total }: { step: number; total: number }) {
  return (
    <div className="h-[3px] bg-neutral-700" aria-hidden="true">
      <div
        className="h-full bg-orange-500"
        style={{ width: `${(step / total) * 100}%` }}
      />
    </div>
  );
}

/**
 * The step header, pinned to the top of the panel: where the reader stands in
 * the collection and the two moves. It stays put while the event under it
 * changes.
 *
 * The controls are the icon `<Button>` (its phone tap step) and sit at the
 * panel's top on every width: below `sm` the panel is the block under the map.
 */
export function ReaderHeader({
  step,
  total,
  onStep,
}: {
  /** 1-based. */
  step: number;
  total: number;
  onStep: (step: number) => void;
}) {
  return (
    <div className="border-b border-neutral-800">
      <ProgressStrip step={step} total={total} />

      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-medium text-neutral-100">
            {step} of {total}
          </p>
          {/* Hidden below `sm`: no keyboard. */}
          <p className="max-sm:hidden text-[11px] text-neutral-500">
            &larr; &rarr; to step
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            icon
            variant="ghost"
            disabled={step <= 1}
            onClick={() => onStep(step - 1)}
            aria-label="Previous event"
            title="Previous event"
          >
            <ChevronLeft size={14} />
          </Button>
          <Button
            icon
            variant="secondary"
            disabled={step >= total}
            onClick={() => onStep(step + 1)}
            aria-label="Next event"
            title="Next event"
          >
            <ChevronRight size={14} />
          </Button>
        </div>
      </div>
    </div>
  );
}
