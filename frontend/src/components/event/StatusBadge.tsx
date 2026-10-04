import { Bot, MapPin, Megaphone, X } from "lucide-react";
import type { ReactNode } from "react";
import type { EventStatus } from "@/types";
import { Pill, type PillTone } from "@/components/ui/Pill";

/**
 * The event lifecycle status as a coloured pill: one badge for all four states on the shared
 * `Pill` shape.
 *
 * - `requested` (accent, megaphone): an open call to geolocate, the actionable state.
 * - `detected` (accent, robot): a machine detection imported from a tweet, marked until the owner
 *   submits it. Accent-tinted, so it follows the user's palette.
 * - `geolocated` (neutral, pin): a point on the map that a person vouched for (via the form, or by
 *   submitting a reviewed detection). It does not claim independent verification. Neutral keeps
 *   the accent states attention-drawing.
 * - `closed` (neutral, cross): a terminal audit row covering a withdrawn request, a rejected
 *   detection and a retracted geolocation; the Reason beside it on detail surfaces says which, and
 *   the `status` concept's `?` names the three.
 *
 * The badge is a label, never an explanation: what a status means is the `status` concept in
 * [`lib/fieldHelp.ts`](../../lib/fieldHelp.ts), read by the `?` on the Status row and the status
 * filter.
 */
/**
 * The reader-facing word and emphasis per status: the one source this badge and the event share
 * card ([`events/[id]/opengraph-image.tsx`](../../app/events/[id]/opengraph-image.tsx)) both read,
 * so a page and its image can't name a row differently. `tone` is the subset both `Pill` and
 * `OgBadge` accept.
 */
export const EVENT_STATUS_META: Record<
  EventStatus,
  { label: string; tone: Extract<PillTone, "accent" | "neutral"> }
> = {
  requested: { label: "Requested", tone: "accent" },
  detected: { label: "Detected", tone: "accent" },
  geolocated: { label: "Geolocated", tone: "neutral" },
  closed: { label: "Closed", tone: "neutral" },
};

/** The glyph half, which the share card (text only) has no use for. */
const STATUS_ICON: Record<EventStatus, ReactNode> = {
  requested: <Megaphone size={11} />,
  detected: <Bot size={11} />,
  geolocated: <MapPin size={11} />,
  closed: <X size={11} />,
};

export function StatusBadge({ status }: { status: EventStatus }) {
  const { label, tone } = EVENT_STATUS_META[status];
  return (
    <Pill tone={tone} icon={STATUS_ICON[status]}>
      {label}
    </Pill>
  );
}
