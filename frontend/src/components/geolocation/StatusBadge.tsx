import { Bot, MapPin, User, X } from "lucide-react";
import type { ReactNode } from "react";
import type { GeolocationStatus } from "@/types";
import { Pill, type PillTone } from "@/components/ui/Pill";

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
 * - `closed` (neutral, a cross): a withdrawn request, kept as an audit row.
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

const STATUS: Record<GeolocationStatus, StatusMeta> = {
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
    title: "The author withdrew this request",
  },
};

export function StatusBadge({ status }: { status: GeolocationStatus }) {
  const meta = STATUS[status];
  return (
    <Pill tone={meta.tone} icon={meta.icon} title={meta.title}>
      {meta.label}
    </Pill>
  );
}
