"use client";

import type { EventDetail } from "@/types";
import { eventPanelContent } from "@/components/event/EventDetailBody";
import { MapSidePanel, type MapSidePanelProps } from "./MapSidePanel";

/** The map's side panel on an event. */
export function DetailSidePanel({
  resource,
  onClose,
}: Omit<MapSidePanelProps<EventDetail>, "errorFallback" | "content">) {
  return (
    <MapSidePanel
      resource={resource}
      onClose={onClose}
      errorFallback="Couldn't load this event."
      content={eventPanelContent}
    />
  );
}
