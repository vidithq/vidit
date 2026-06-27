import Link from "next/link";
import { ArrowRight, Bot } from "lucide-react";

/**
 * Own-profile entry point into the review queue. Surfaces the count of
 * machine-`detected` geolocations awaiting the owner's validation and links to
 * `/profile/{username}/review`. The parent renders it only when `count > 0`, so
 * a clean profile stays clean. Amber to match `StatusBadge` — the same
 * "machine, pending" signal.
 */
export function ReviewQueueEntry({
  username,
  count,
}: {
  username: string;
  count: number;
}) {
  return (
    <Link
      href={`/profile/${username}/review`}
      className="group flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 hover:bg-amber-500/15 transition-colors"
    >
      <div className="flex items-center gap-3">
        <span className="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-400">
          <Bot size={18} />
          {/* Same orange dot as the sidebar profile row, so the user ties the
              sidebar nudge to this block. */}
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-orange-500 ring-2 ring-neutral-950"
          />
        </span>
        <div>
          <p className="text-sm font-medium text-neutral-100">
            {count} {count === 1 ? "detection" : "detections"} to review
          </p>
          <p className="text-xs text-neutral-400">
            Machine-found geolocations awaiting your validation.
          </p>
        </div>
      </div>
      <ArrowRight
        size={16}
        className="shrink-0 text-amber-400 transition-transform group-hover:translate-x-0.5"
      />
    </Link>
  );
}
