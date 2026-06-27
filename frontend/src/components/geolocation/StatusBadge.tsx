import { BadgeCheck, Bot } from "lucide-react";
import type { GeolocationState } from "@/types";

/**
 * The geolocation's lifecycle status, shown explicitly for **both** states so a
 * reader never has to infer it from an absent badge:
 *
 * - `detected` — amber, a machine draft imported from a tweet, pending the
 *   owner's validation. The one that must stand out.
 * - `validated` — neutral, submitted or vouched for by a human (the default,
 *   trusted state). Neutral, not green: it keeps the palette tight (orange =
 *   clickable, amber = detected) and lets the amber `detected` remain the
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
        title="Machine-detected from a tweet — pending the owner's validation"
        className={`inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400 ${className}`}
      >
        <Bot size={11} />
        Detected
      </span>
    );
  }
  return (
    <span
      title="Validated — submitted or vouched for by a human"
      className={`inline-flex items-center gap-1 rounded-full border border-neutral-600/50 bg-neutral-700/40 px-1.5 py-0.5 text-[10px] font-medium text-neutral-300 ${className}`}
    >
      <BadgeCheck size={11} />
      Validated
    </span>
  );
}
