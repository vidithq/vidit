"use client";

import type { EventDetail } from "@/types";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { EventDetailBody } from "@/components/event/EventDetailBody";
import { creditProps } from "@/lib/geolocatorCredit";
import { eventHref } from "@/lib/routes";
import { MapSidePanel, type MapSidePanelProps } from "./MapSidePanel";

/** The map's side panel on an event: its title, the byline and the event body. */
export function DetailSidePanel({
  resource,
  onClose,
}: Omit<MapSidePanelProps<EventDetail>, "errorFallback" | "heading" | "children">) {
  return (
    <MapSidePanel
      resource={resource}
      onClose={onClose}
      errorFallback="Couldn't load this event."
      heading={(detail) => ({
        title: detail.title,
        href: eventHref(detail.id),
        meta: (
          <p className="text-xs text-neutral-400">
            <AuthorByline {...creditProps(detail)} size="xs" avatar />
          </p>
        ),
      })}
    >
      {(detail) => <EventDetailBody geo={detail} />}
    </MapSidePanel>
  );
}
