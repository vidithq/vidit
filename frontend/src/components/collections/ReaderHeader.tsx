"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { READER_MAX_ITEMS } from "@/lib/collections";

/** Past this many items the strip stops being one segment per event: a segment
 *  thinner than a hairline says nothing, so the bar fills continuously
 *  instead. The figure is what fits the 384px panel at 2px gaps. */
const SEGMENTED_UP_TO = 24;

/**
 * How far along the reader is, drawn on the panel's top edge.
 *
 * One segment per event while a collection is short enough for a segment to be
 * visible, a continuous fill past that. Decorative: the same two numbers are
 * written out as `N of M` under it, so nothing here is announced twice.
 */
function ProgressStrip({ step, total }: { step: number; total: number }) {
  if (total > SEGMENTED_UP_TO) {
    return (
      <div className="h-[3px] bg-neutral-700" aria-hidden="true">
        <div
          className="h-full bg-orange-500"
          style={{ width: `${(step / total) * 100}%` }}
        />
      </div>
    );
  }
  return (
    <div className="flex gap-[2px] h-[3px]" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`flex-1 ${
            i + 1 === step
              ? "bg-orange-500"
              : i + 1 < step
                ? "bg-orange-500/45"
                : "bg-neutral-700"
          }`}
        />
      ))}
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
  capped,
  onStep,
}: {
  /** Which item is being read, 1-based. */
  step: number;
  total: number;
  /** True when the collection holds more than the page steps through. */
  capped: boolean;
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
          {capped && (
            <p className="text-[11px] text-neutral-500">
              First {READER_MAX_ITEMS} events of this collection.
            </p>
          )}
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
