import { formatPeriod } from "@/lib/format";
import { ACCENT_SURFACE } from "./styles";

/** One bar of the row. `period` is the backend's bucket key (`YYYY-MM`,
 *  `YYYY-Qn` or `YYYY`); it keys the bar, labels the hover tooltip and, by
 *  its shape, says which granularity the row is drawn at. Mirrors the
 *  backend's zero-filled activity bucket. */
export interface ActivityBucket {
  period: string;
  count: number;
}

// A row of activity bars: one bar per bucket, heights relative to the max
// count. Dumb by design: the caller owns the window (the backend derives it
// from the analyst's own span and zero-fills it), this only paints it. Active
// buckets use the accent surface paint; empty ones a neutral stub, so a quiet
// stretch still reads as part of the row. The first and last period label the
// ends, so the span a row covers is readable without hovering a bar.
//
// Two spans have no chart to draw and get a sentence instead: none at all
// (nothing to plot) and one bucket (a lone bar carries no shape, and reads as
// a bug rather than as a fact).
export function ActivityBars({ buckets }: { buckets: ActivityBucket[] }) {
  if (buckets.length === 0) {
    return <p className="text-xs text-neutral-500">No event carries a date yet.</p>;
  }

  if (buckets.length === 1) {
    const only = buckets[0];
    return (
      <p className="text-xs text-neutral-500">
        {only.count} {only.count === 1 ? "event" : "events"}, all in{" "}
        {formatPeriod(only.period)}.
      </p>
    );
  }

  const max = Math.max(1, ...buckets.map((b) => b.count));
  return (
    <div>
      <div className="flex h-10 items-end gap-1">
        {buckets.map((b) => (
          <div
            key={b.period}
            title={`${formatPeriod(b.period)}: ${b.count}`}
            className={`flex-1 rounded-sm ${b.count > 0 ? ACCENT_SURFACE : "bg-neutral-800"}`}
            // Active bars keep a visible floor so a 1-in-a-big-max bucket
            // doesn't collapse to a sliver; empty ones stay a low stub.
            style={{ height: b.count > 0 ? `${Math.max(15, (b.count / max) * 100)}%` : "8%" }}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-neutral-500">
        <span>{formatPeriod(buckets[0].period)}</span>
        <span>{formatPeriod(buckets[buckets.length - 1].period)}</span>
      </div>
    </div>
  );
}
