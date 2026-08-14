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

// One corner treatment and one empty-month hairline, shared by the grid and by
// the legend under it, so the swatch explaining the scale is drawn as the thing
// it explains rather than as a second shape that can drift from it. The
// hairline is what keeps a quiet stretch reading as a drawn cell rather than as
// a hole, and it rules the grid the way a calendar is ruled; `neutral-700` is
// the <Card> border value, so it stays a hairline in both themes.
// The radius follows the cell: 4px on the 36px cell of a full card reads as a
// calendar tile, while the same 4px on the 14px cell a 375 px screen leaves
// rounds it into a capsule.
const CELL_CORNER = "rounded-[3px] sm:rounded-sm";
const EMPTY_RING = `${CHART_NEUTRAL} ring-1 ring-inset ring-neutral-700`;

// The grid's own box: full column width, capped height. Twelve square cells
// across a full-width card become a wall of 55px blocks; a bounded row reads as
// a month strip, and 24px still takes a thumb at 375 px.
const GRID_CELL = `${CELL_CORNER} h-6 w-full sm:h-7`;
const LEGEND_CELL = `${CELL_CORNER} h-3 w-4`;

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
    // Capped rather than stretched: across a full-width card twelve columns
    // give 60px cells, and a calendar month is not a banner. The cap holds the
    // cell near its own height, and the caption line under the grid takes the
    // same width so the legend stays at the grid's right edge.
    <div className="max-w-lg">
      {/* Months sit tighter than years: the wider row gap is what groups a
          twelve-cell run into one calendar year rather than one long strip. */}
      <div className="grid grid-cols-[auto_repeat(12,minmax(0,1fr))] items-center gap-x-1 gap-y-1.5">
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
                  <div key={period} title={label} className={`${GRID_CELL} ${EMPTY_RING}`} />
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
                  // The picked month lifts out of the grid: a ring held off the
                  // cell by the card's own colour, so the outline reads on a
                  // faint month and on a full-strength one alike. Hover and
                  // keyboard focus land on the same state, since both mean the
                  // same thing here, the month the readout is naming. The ring
                  // is the accent at full strength, which is the one step of
                  // the scale that holds on the dark card and on the light one.
                  className={`${GRID_CELL} outline-hidden ring-offset-1 ring-offset-neutral-900 transition-shadow hover:ring-2 hover:ring-orange-500 focus-visible:ring-2 focus-visible:ring-orange-500 ${paint}`}
                />
              );
            })}
          </Fragment>
        ))}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[10px] text-neutral-500">
        <span aria-live="polite">{readout ?? span}</span>
        <span className="flex items-center gap-1">
          Less
          <span className={`${LEGEND_CELL} ${EMPTY_RING}`} />
          {LEVELS.slice()
            .reverse()
            .map((paint) => (
              <span key={paint} className={`${LEGEND_CELL} ${paint}`} />
            ))}
          More
        </span>
      </div>
    </div>
  );
}
