import { Bot, MapPin, User, X } from "lucide-react";
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
 * this and `BountyStatusBadge` now that bounties and geolocations are one event.
 *
 * - `requested` (accent, a pin): an open call to geolocate (the requested /
 *   bounty view). Accent draws attention: it's the actionable, still-open state.
 * - `detected` (accent, a robot): a machine draft imported from a tweet, shown
 *   marked until the owner submits it. The mark that must stand out. Accent-
 *   tinted, so it follows the user's chosen palette.
 * - `geolocated` (neutral, a person): a person vouched for it (via the form, or
 *   by submitting a reviewed detection). The default located state. It does NOT
 *   claim independent verification, only that a person stands behind it; the
 *   neutral colour keeps the accent states the attention-drawing marks.
 * - `closed` (neutral, a cross): a terminal audit row. Its tooltip reflects
 *   ``before_closed_status`` when supplied (a withdrawn request vs a rejected
 *   detection) since the one badge covers both dismissal shapes.
 *
 * Shown on cards, the detail pages (geolocation + requested), search results,
 * and the Detections queue.
 */
interface StatusMeta {
  tone: PillTone;
  icon: ReactNode;
  label: string;
  title: string;
}

const STATUS: Record<EventStatus, StatusMeta> = {
  requested: {
    tone: "accent",
    icon: <MapPin size={11} />,
    label: "Requested",
    title: "An open request to geolocate this footage",
  },
  detected: {
    tone: "accent",
    icon: <Bot size={11} />,
    label: "Detected",
    title: "Machine-detected from a tweet, shown until the owner submits it",
  },
  geolocated: {
    tone: "neutral",
    icon: <User size={11} />,
    label: "Geolocated",
    title: "Geolocated by a person, not independently verified",
  },
  closed: {
    tone: "neutral",
    icon: <X size={11} />,
    label: "Closed",
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
  const title = status === "closed" ? closedTitle(beforeClosedStatus) : meta.title;
  return (
    <Pill tone={meta.tone} icon={meta.icon} title={title}>
      {meta.label}
    </Pill>
  );
}
