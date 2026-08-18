import { Bot, MapPin, Megaphone, X } from "lucide-react";
import type { ReactNode } from "react";
import type { EventStatus } from "@/types";
import { Pill, type PillTone } from "@/components/ui/Pill";

/**
 * The unified event lifecycle status as a coloured pill: one badge for all four
 * states, sharing the one `Pill` shape. Consolidates the former split between
 * this and `RequestStatusBadge` now that requests and geolocations are one event.
 *
 * - `requested` (accent, a megaphone): an open call to geolocate (the requested /
 *   request view). Accent draws attention: it's the actionable, still-open state.
 * - `detected` (accent, a robot): a machine detection imported from a tweet, shown
 *   marked until the owner submits it. The mark that must stand out. Accent-
 *   tinted, so it follows the user's chosen palette.
 * - `geolocated` (neutral, a pin): the located state, a point on the map.
 *   A person vouched for it (via the form, or by submitting a reviewed
 *   detection); it does NOT claim independent verification, only that a person
 *   stands behind it. The neutral colour keeps the accent states the
 *   attention-drawing marks.
 * - `closed` (neutral, a cross): a terminal audit row. The one badge covers
 *   both dismissal shapes; which one this row took is the Reason beside it on
 *   the detail surfaces, and the `status` concept's `?` names the pair.
 *
 * The badge is a label, never an explanation: what a status means is the
 * `status` concept in [`lib/fieldHelp.ts`](../../lib/fieldHelp.ts), read by the
 * `?` on the Status row and on the status filter.
 *
 * Shown on cards, the detail pages (geolocation + requested), search results,
 * and the Detections queue.
 */
/**
 * The reader-facing word and emphasis for each lifecycle status: the one source
 * this badge and the generated event share card
 * ([`events/[id]/opengraph-image.tsx`](../../app/events/[id]/opengraph-image.tsx))
 * both read, so a page and the image of that page cannot name the same row
 * differently. `tone` is the two-value subset both renderers accept, `Pill`'s
 * and `OgBadge`'s, so neither has to translate it.
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

/** The glyph half, which the share card has no use for (it renders text only). */
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
