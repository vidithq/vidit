import { Bot, User } from "lucide-react";
import type { GeolocationStatus } from "@/types";
import { Pill } from "@/components/ui/Pill";
import { STATUS_PILL_ACTIVE } from "@/components/ui/styles";

// `submitted` is neutral, not one of the shared status-pill tones: it's the
// quiet default that keeps the accent `detected` the attention-drawing mark.
const SUBMITTED_TONE =
  "bg-neutral-700/40 text-neutral-300 border border-neutral-600/50";

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
      <Pill
        tone={STATUS_PILL_ACTIVE}
        icon={<Bot size={11} />}
        title="Machine-detected from a tweet, shown until the owner submits it"
        className={className}
      >
        Detected
      </Pill>
    );
  }
  return (
    <Pill
      tone={SUBMITTED_TONE}
      icon={<User size={11} />}
      title="Submitted by a person, not independently verified"
      className={className}
    >
      Submitted
    </Pill>
  );
}
