"use client";

import { formatDate } from "@/lib/format";
import type { EventDetail } from "@/types";
import { ShareControl } from "@/components/share/ShareControl";

/**
 * The event's **Share** control: the page's address and title for the share sheet, and the X post
 * body (title, credit line, coordinates). A `detected` row is still editable by its owner, so a
 * shared link's content may change: the control carries that caveat.
 */
export function EventShare({ event }: { event: EventDetail }) {
  const coords = event.event_coords;
  const lines = [
    event.title,
    `by ${event.owner.username}${event.event_date ? ` · ${formatDate(event.event_date)}` : ""}`,
    ...(coords ? [`${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}`] : []),
  ];
  return (
    <ShareControl
      path={`/events/${event.id}`}
      title={event.title}
      lines={lines}
      caveat={event.status === "detected" ? "Detected and may still change." : undefined}
    />
  );
}
