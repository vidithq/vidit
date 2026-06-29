import { Bot, User } from "lucide-react";
import type { GeolocationStatus } from "@/types";

/**
 * The geolocation's lifecycle status, shown explicitly for **both** states as a
 * machine-vs-person pair with coherent icons and no "verified" check (the state
 * isn't a truth claim):
 *
 * - `detected` (accent, a robot): a machine draft imported from a tweet, shown
 *   until the owner submits it. The mark that must stand out. Accent-tinted, so
 *   it follows the user's chosen palette.
 * - `submitted` (neutral, a person): a person submitted it (via the form, or by
 *   submitting a reviewed detection). The default state. It does NOT claim
 *   independent verification, only that a person stands behind it; the neutral
 *   colour keeps the accent `detected` the attention-drawing mark.
 *
 * Shown on cards, the detail page, search results, and the Detections queue.
 */
export default function StatusBadge({
  status,
  className = "",
}: {
  status: GeolocationStatus;
  className?: string;
}) {
  if (status === "detected") {
    return (
      <span
        title="Machine-detected from a tweet, shown until the owner submits it"
        className={`inline-flex items-center gap-1 rounded-full border border-orange-500/30 bg-orange-500/15 px-1.5 py-0.5 text-[10px] font-medium text-orange-400 ${className}`}
      >
        <Bot size={11} />
        Detected
      </span>
    );
  }
  return (
    <span
      title="Submitted by a person, not independently verified"
      className={`inline-flex items-center gap-1 rounded-full border border-neutral-600/50 bg-neutral-700/40 px-1.5 py-0.5 text-[10px] font-medium text-neutral-300 ${className}`}
    >
      <User size={11} />
      Submitted
    </span>
  );
}
