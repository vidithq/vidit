import Link from "next/link";
import { ArrowRight, Bot } from "lucide-react";

/**
 * Own-profile entry point into the detections list. Surfaces the count of
 * machine-`detected` geolocations awaiting the owner's submission and links to
 * `/profile/{username}/detections`. The parent renders it only when `count > 0`,
 * so a clean profile stays clean. Accent-tinted to match `StatusBadge`, the same
 * "machine, pending" signal, and follows the user's chosen palette.
 */
export function DetectionsEntry({
  username,
  count,
}: {
  username: string;
  count: number;
}) {
  return (
    <Link
      href={`/profile/${username}/detections`}
      className="group flex items-center justify-between gap-3 rounded-lg border border-orange-500/30 bg-orange-500/10 p-4 hover:bg-orange-500/15 transition-colors"
    >
      <div className="flex items-center gap-3">
        <span className="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-orange-500/15 text-orange-400">
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
            {count} {count === 1 ? "detection" : "detections"} to submit
          </p>
          <p className="text-xs text-neutral-400">
            Machine-found geolocations awaiting submission.
          </p>
        </div>
      </div>
      <ArrowRight
        size={16}
        className="shrink-0 text-orange-400 transition-transform group-hover:translate-x-0.5"
      />
    </Link>
  );
}
