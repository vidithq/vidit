import { ACCENT_SURFACE } from "./styles";

/** One bar of the row. `month` is `YYYY-MM`; it keys the bar and titles the
 *  hover tooltip. Mirrors the backend's zero-filled monthly bucket. */
export interface ActivityBucket {
  month: string;
  count: number;
}

// A fixed-width row of monthly activity bars (profile insights): one bar per
// bucket, heights relative to the max count. Dumb by design: the caller owns
// the window (the backend zero-fills 12 months), this only paints it. Active
// months use the accent surface paint; empty months a neutral stub, so a
// quiet year still reads as a full-width row.
export function ActivityBars({ buckets }: { buckets: ActivityBucket[] }) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return (
    <div className="flex h-10 items-end gap-1">
      {buckets.map((b) => (
        <div
          key={b.month}
          title={`${b.month}: ${b.count}`}
          className={`flex-1 rounded-sm ${b.count > 0 ? ACCENT_SURFACE : "bg-neutral-800"}`}
          // Active bars keep a visible floor so a 1-in-a-big-max month
          // doesn't collapse to a sliver; empty months stay a low stub.
          style={{ height: b.count > 0 ? `${Math.max(15, (b.count / max) * 100)}%` : "8%" }}
        />
      ))}
    </div>
  );
}
