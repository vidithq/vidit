"use client";

import { Fragment, useState } from "react";

import { formatMonth } from "@/lib/format";
import type { components } from "@/lib/api-types";
import { ACCENT_RAMP, CHART_NEUTRAL } from "./styles";

/** One month of the grid. `period` is the backend's zero-filled `YYYY-MM` key. */
export type ActivityBucket = components["schemas"]["ActivityBucket"];

// Same formatter and locale as the readout below the grid.
const MONTH_LABELS = Array.from({ length: 12 }, (_, i) =>
  new Date(Date.UTC(2000, i, 1)).toLocaleDateString("en-GB", {
    month: "short",
    timeZone: "UTC",
  })
);

// The faintest ramp step is left out: against an empty cell it reads as noise.
const LEVELS = ACCENT_RAMP.slice(0, 4);

/**
 * A contribution grid at month resolution: one row per calendar year, twelve
 * cells wide, intensity carrying the count.
 *
 * Months, not days: an analyst publishes tens of events a year, so a daily grid
 * would be blank. Every month of every year in the span renders, so a quiet
 * stretch reads as empty, not missing.
 *
 * Hover or tap a month and the line under the grid names it and its count;
 * otherwise it states the span. One line, not a tooltip per cell, since a phone
 * has no hover. Cells are paint, not controls.
 *
 * No dated event at all gets a sentence. A single-month span keeps the grid: the
 * empty cells beside the lit one say which month it was.
 */
export function ActivityHeatmap({ buckets }: { buckets: ActivityBucket[] }) {
  const [readout, setReadout] = useState<string | null>(null);

  if (buckets.length === 0) {
    return <p className="text-xs text-neutral-500">No event carries a date yet.</p>;
  }

  const counts = new Map(buckets.map((bucket) => [bucket.period, bucket.count]));
  const max = Math.max(1, ...buckets.map((bucket) => bucket.count));
  const firstYear = Number(buckets[0].period.slice(0, 4));
  const lastYear = Number(buckets[buckets.length - 1].period.slice(0, 4));
  const years = Array.from({ length: lastYear - firstYear + 1 }, (_, i) => firstYear + i);
  // "Covering", not a bare year: a lone "2024" under the labels reads as a row
  // that lost its cells.
  const span =
    firstYear === lastYear
      ? `Covering ${firstYear}`
      : `Covering ${firstYear} to ${lastYear}`;

  return (
    <div>
      <div className="grid grid-cols-[auto_repeat(12,minmax(0,1fr))] items-center gap-[3px]">
        {/* Cells carry their own month and count, so the header is sighted-only. */}
        <span aria-hidden="true" />
        {MONTH_LABELS.map((label) => (
          <span
            key={label}
            aria-hidden="true"
            className="text-center text-[10px] leading-none text-neutral-500"
          >
            {/* One letter at phone width, where three letters overflow the column. */}
            <span className="sm:hidden">{label.slice(0, 1)}</span>
            <span className="hidden sm:inline">{label}</span>
          </span>
        ))}

        {years.map((year) => (
          <Fragment key={year}>
            <span className="pr-1 text-right text-[10px] leading-none tabular-nums text-neutral-500">
              {year}
            </span>
            {MONTH_LABELS.map((_, index) => {
              const period = `${year}-${String(index + 1).padStart(2, "0")}`;
              const count = counts.get(period) ?? 0;
              const label = `${formatMonth(period)} · ${count} ${
                count === 1 ? "event" : "events"
              }`;
              if (count === 0) {
                return (
                  <div
                    key={period}
                    title={label}
                    className={`aspect-square rounded-[2px] ${CHART_NEUTRAL}`}
                  />
                );
              }
              // Level 1 to 4 by share of the busiest month; the ramp runs
              // strongest-first.
              const paint = LEVELS[LEVELS.length - Math.ceil((count / max) * LEVELS.length)];
              return (
                <div
                  key={period}
                  title={label}
                  onMouseEnter={() => setReadout(label)}
                  onMouseLeave={() => setReadout(null)}
                  onClick={() => setReadout(label)}
                  className={`aspect-square rounded-[2px] ${paint}`}
                />
              );
            })}
          </Fragment>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[10px] text-neutral-500">
        <span aria-live="polite">{readout ?? span}</span>
        <span className="flex items-center gap-1">
          Less
          <span className={`size-2 rounded-[2px] ${CHART_NEUTRAL}`} />
          {LEVELS.slice()
            .reverse()
            .map((paint) => (
              <span key={paint} className={`size-2 rounded-[2px] ${paint}`} />
            ))}
          More
        </span>
      </div>
    </div>
  );
}
