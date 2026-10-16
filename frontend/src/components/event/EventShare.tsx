"use client";

import type { EventDetail } from "@/types";
import { ShareControl } from "@/components/share/ShareControl";

/**
 * The event's **Share** control. A `detected` row is still editable by its owner, so a shared
 * link's content may change: the control carries that caveat.
 */
export function EventShare({ event }: { event: EventDetail }) {
  return (
    <ShareControl
      path={`/events/${event.id}`}
      title={event.title}
      caveat={event.status === "detected" ? "Detected and may still change." : undefined}
    />
  );
}
