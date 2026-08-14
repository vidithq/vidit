"use client";

import { Fragment, useState } from "react";

import { formatMonth } from "@/lib/format";
import { ACCENT_RAMP, CHART_NEUTRAL } from "./styles";

/** One month of the grid. `period` is the backend's bucket key (`YYYY-MM`);
 *  it keys the cell and names it in the readout. Mirrors the backend's
 *  zero-filled activity bucket. */
export interface ActivityBucket {
  period: string;
  count: number;
}

// The twelve column labels, derived rather than listed so the month names come
// from the same formatter and locale as the readout below the grid.
const MONTH_LABELS = Array.from({ length: 12 }, (_, i) =>
  new Date(Date.UTC(2000, i, 1)).toLocaleDateString("en-GB", {
    month: "short",
    timeZone: "UTC",
  })
);

// The four strongest ramp steps carry the four intensity levels. The faintest
// step is left out: against an empty cell it reads as noise rather than as a
// count.
const LEVELS = ACCENT_RAMP.slice(0, 4);

/**
 * A contribution grid at month resolution: one row per calendar year, twelve
 * month cells wide, intensity carrying the count.
 *
 * Months, not days. An analyst publishes tens of events a year, so a daily
 * grid would be blank almost everywhere; a month cell over the whole span the
 * caller supplies is dense enough to show the seasons and the gaps. Every
 * month of every year in the span renders, so a quiet stretch reads as empty
 * rather than as missing, and the year labels say exactly which years are on
 * screen.
 *
 * Hover, tap or keyboard-focus a month and the line under the grid names it
 * and its count; with nothing picked that line states the span. The readout is
 * one line rather than a tooltip per cell because at 375 px there is no hover
 * to summon a tooltip with. Only months carrying events are focusable, so a
 * five-year grid costs a keyboard reader the tens of stops that mean
 * something, not 120.
 *
 * One span has no grid to draw and gets a sentence: no dated event at all. A
 * span of a single month keeps the grid, because the eleven empty cells beside
 * the lit one are what say *which* month it was.
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
  // "Covering", not a bare year: the line sits under the year labels, and on a
  // one-year grid a lone "2024" there reads as a second row that lost its
  // cells.
  const span =
    firstYear === lastYear
      ? `Covering ${firstYear}`
      : `Covering ${firstYear} to ${lastYear}`;

  return (
    <div>
      <div className="grid grid-cols-[auto_repeat(12,minmax(0,1fr))] items-center gap-[3px]">
        {/* The header names the columns for a sighted reader; every cell
            carries its own month and count for everyone else, so repeating
            the row to a screen reader would only double the grid. */}
        <span aria-hidden="true" />
        {MONTH_LABELS.map((label) => (
          <span
            key={label}
            aria-hidden="true"
            className="text-center text-[10px] leading-none text-neutral-500"
          >
            {/* One letter at phone width, where a three-letter label is wider
                than its own column. */}
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
              // Level 1 to 4 off the month's share of the busiest month, then
              // read off the ramp strongest-last.
              const paint = LEVELS[LEVELS.length - Math.ceil((count / max) * LEVELS.length)];
              return (
                <button
                  key={period}
                  type="button"
                  title={label}
                  aria-label={label}
                  onMouseEnter={() => setReadout(label)}
                  onMouseLeave={() => setReadout(null)}
                  onFocus={() => setReadout(label)}
                  onBlur={() => setReadout(null)}
                  onClick={() => setReadout(label)}
                  // The focus ring is the accent at full strength: the light
                  // theme repoints the neutral scale but leaves the accent
                  // alone, so a 300-stop ring on the near-white card is the
                  // same pale tint as the card and disappears. The 500 stop is
                  // the one step that holds on the dark card and the light one.
                  className={`aspect-square rounded-[2px] outline-hidden focus-visible:ring-1 focus-visible:ring-orange-500 ${paint}`}
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
