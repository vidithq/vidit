"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/Button";

/**
 * How far along the reader is, drawn on the panel's top edge as a continuous
 * fill.
 *
 * Decorative: the same two numbers are written out as `N of M` under it, so
 * nothing here is announced twice.
 */
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
 * The step header, pinned to the top of the panel the collection page reads
 * its current event in.
 *
 * It says where in the collection the reader stands and offers the two moves.
 * The event under it changes on every step; this block does not, which is what
 * lets a reader hold the position of the next control while stepping.
 *
 * The controls are the site's icon `<Button>`, so they take its phone tap step
 * (`ICON_TAP_STEP`, a 36px square below `sm`) rather than a second figure of
 * their own, and they sit at the panel's top on every width: below `sm` the
 * panel is the block under the map, so its top edge is what a reader reaches
 * first after the map rather than a sheet edge under a thumb.
 */
export function ReaderHeader({
  step,
  total,
  onStep,
}: {
  /** Which item is being read, 1-based. */
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
          {/* The keys that do the same thing, where the controls are. Hidden
              below `sm`, where there is no keyboard to press. */}
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
