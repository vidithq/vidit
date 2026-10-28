import Link from "next/link";
import { ArrowRight, Bot } from "lucide-react";

import { ACCENT_SURFACE } from "@/components/ui/styles";
import { Dot } from "@/components/ui/Dot";
import { countLabel } from "@/lib/format";
import { detectionsQueueHref } from "@/lib/routes";

/** Own-profile entry into the detections list: the count of machine-`detected` geolocations to
 * review, linking to `/profile/{username}/detections`. The parent renders it only when
 * `count > 0`. Accent-tinted like `StatusBadge`, the same "machine, pending" signal. */
export function DetectionsEntry({
  username,
  count,
}: {
  username: string;
  count: number;
}) {
  return (
    <Link
      href={detectionsQueueHref(username)}
      className="group flex items-center justify-between gap-3 rounded-lg border border-orange-500/30 bg-orange-500/10 p-4 hover:bg-orange-500/15 transition-colors"
    >
      <div className="flex items-center gap-3">
        <span className={`relative flex size-9 shrink-0 items-center justify-center rounded-full ${ACCENT_SURFACE}`}>
          <Bot size={18} />
          {/* Same orange dot as the sidebar profile row, tying the nudge to this block. */}
          <Dot className="absolute -top-0.5 -right-0.5 size-2.5 ring-2 ring-neutral-950" />
        </span>
        <p className="text-sm font-medium text-neutral-100">
          {countLabel(count, "detection")} to review
        </p>
      </div>
      <ArrowRight
        size={16}
        className="shrink-0 text-orange-400 transition-transform group-hover:translate-x-0.5"
      />
    </Link>
  );
}
