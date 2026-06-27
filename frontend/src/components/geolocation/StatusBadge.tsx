import { Bot, User } from "lucide-react";
import type { GeolocationState } from "@/types";

/**
 * The geolocation's lifecycle status, shown explicitly for **both** states as a
 * machine-vs-human pair — coherent icons, and no "verified" check (the state
 * isn't a truth claim):
 *
 * - `detected` — amber, a robot: a machine draft imported from a tweet, pending
 *   the owner's review. The mark that must stand out.
 * - `human` — neutral, a person: submitted or vouched for by a human (the
 *   default state). It does NOT claim independent verification — only that a
 *   person stands behind it; the neutral colour keeps the amber `detected` the
 *   attention-drawing mark.
 *
 * Shown on cards, the detail page, search results, and the review queue.
 */
export default function StatusBadge({
  state,
  className = "",
}: {
  state: GeolocationState;
  className?: string;
}) {
  if (state === "detected") {
    return (
      <span
        title="Machine-detected from a tweet — pending the owner's review"
        className={`inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400 ${className}`}
      >
        <Bot size={11} />
        Detected
      </span>
    );
  }
  return (
    <span
      title="Submitted or vouched for by a human — not independently verified"
      className={`inline-flex items-center gap-1 rounded-full border border-neutral-600/50 bg-neutral-700/40 px-1.5 py-0.5 text-[10px] font-medium text-neutral-300 ${className}`}
    >
      <User size={11} />
      Human
    </span>
  );
}
