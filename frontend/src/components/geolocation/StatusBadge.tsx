import { Bot, User } from "lucide-react";
import type { GeolocationStatus } from "@/types";
import { Pill } from "@/components/ui/Pill";

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
export function StatusBadge({ status }: { status: GeolocationStatus }) {
  if (status === "detected") {
    return (
      <Pill
        tone="accent"
        icon={<Bot size={11} />}
        title="Machine-detected from a tweet, shown until the owner submits it"
      >
        Detected
      </Pill>
    );
  }
  return (
    <Pill
      tone="neutral"
      icon={<User size={11} />}
      title="Submitted by a person, not independently verified"
    >
      Submitted
    </Pill>
  );
}
