import { Bot } from "lucide-react";
import type { GeolocationState } from "@/types";

/**
 * Marks a machine-`detected` geolocation. Renders nothing for `validated`
 * (the absence IS the "validated" signal, like TrustBadge). Shown on cards,
 * the detail page, and search results so a machine detection never reads as a
 * human-validated submission.
 *
 * Amber, not orange: orange is reserved for clickable affordances, and this is
 * a passive status mark.
 */
export default function DetectedBadge({
  state,
  className = "",
}: {
  state: GeolocationState;
  className?: string;
}) {
  if (state !== "detected") return null;
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
