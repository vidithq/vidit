import { Bot, MapPin, Megaphone, X } from "lucide-react";
import type { ReactNode } from "react";
import type { components } from "@/lib/api-types";
import type { EventStatus } from "@/types";
import { Pill, type PillTone } from "@/components/ui/Pill";

/** The status a closed row held just before closing: `requested` = the author
 *  withdrew a request, `detected` = the owner rejected a detection. */
type BeforeClosedStatus = components["schemas"]["EventRead"]["before_closed_status"];

/**
 * The unified event lifecycle status as a coloured pill: one badge for all four
 * states, sharing the one `Pill` shape. Consolidates the former split between
 * this and `RequestStatusBadge` now that requests and geolocations are one event.
 *
 * - `requested` (accent, a megaphone): an open call to geolocate (the requested /
 *   request view). Accent draws attention: it's the actionable, still-open state.
 * - `detected` (accent, a robot): a machine draft imported from a tweet, shown
 *   marked until the owner submits it. The mark that must stand out. Accent-
 *   tinted, so it follows the user's chosen palette.
 * - `geolocated` (neutral, a pin): the located state, a point on the map.
 *   A person vouched for it (via the form, or by submitting a reviewed
 *   detection); it does NOT claim independent verification, only that a person
 *   stands behind it. The neutral colour keeps the accent states the
 *   attention-drawing marks.
 * - `closed` (neutral, a cross): a terminal audit row. Its tooltip reflects
 *   ``before_closed_status`` when supplied (a withdrawn request vs a rejected
 *   detection) since the one badge covers both dismissal shapes.
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

/** The icon and tooltip half, which only the page badge has a use for. */
interface StatusMeta {
  icon: ReactNode;
  title: string;
}

const STATUS: Record<EventStatus, StatusMeta> = {
  requested: {
    icon: <Megaphone size={11} />,
    title: "An open request to geolocate this footage",
  },
  detected: {
    icon: <Bot size={11} />,
    title: "Machine-detected from a tweet, shown until the owner submits it",
  },
  geolocated: {
    icon: <MapPin size={11} />,
    title: "Geolocated by a person, not independently verified",
  },
  closed: {
    icon: <X size={11} />,
    // Generic fallback; `closedTitle` refines it from `before_closed_status`.
    title: "Closed, kept as an audit row",
  },
};

/** The closed tooltip, keyed off which state the row left. */
function closedTitle(before: BeforeClosedStatus): string {
  if (before === "requested") return "The author withdrew this request";
  if (before === "detected") return "The owner rejected this detection";
  return STATUS.closed.title;
}

export function StatusBadge({
  status,
  beforeClosedStatus = null,
}: {
  status: EventStatus;
  /** For a `closed` row, the status it held before closing, so the tooltip
   *  tells a withdrawn request from a rejected detection. Ignored otherwise. */
  beforeClosedStatus?: BeforeClosedStatus;
}) {
  const meta = STATUS[status];
  const { label, tone } = EVENT_STATUS_META[status];
  const title = status === "closed" ? closedTitle(beforeClosedStatus) : meta.title;
  return (
    <Pill tone={tone} icon={meta.icon} title={title}>
      {label}
    </Pill>
  );
}
