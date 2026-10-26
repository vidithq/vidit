"use client";

import type { ReactNode } from "react";

import { EmptyState } from "@/components/ui/EmptyState";
import { EntityCard } from "@/components/ui/EntityCard";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { eventHref } from "@/lib/routes";
import { formatDistance, sortLinkedEvents, type SiteLinkedEvent } from "@/lib/sites";
import { LinkEffectPill } from "./SiteBadges";

function where(insideZone: boolean, distance: number | null): string {
  if (insideZone || distance === null || distance === 0) return "Inside the zone";
  return `${formatDistance(distance)} outside the zone`;
}

/**
 * The site page's Linked events section, newest event date first: one catalogue card per event,
 * with its thumbnail, title, author, date, where it lies against the contour it was measured
 * against, and its effect. Each card opens the event; `controls` adds the author's controls.
 */
export function LinkedEvents({
  events,
  controls,
}: {
  events: SiteLinkedEvent[];
  controls: (event: SiteLinkedEvent) => ReactNode;
}) {
  return (
    <section>
      <SectionEyebrow title={`Linked events (${events.length})`} concept="site_linked_events" />
      {events.length === 0 ? (
        <EmptyState>
          No event is linked yet. The author of an event links it from the event page or from here.
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {sortLinkedEvents(events).map((event) => (
            <li key={event.id}>
              <EntityCard
                variant="compact"
                uniformHeight={false}
                detailHref={eventHref(event.id)}
                title={event.title}
                media={event.media ?? undefined}
                isGraphic={event.is_graphic}
                author={event.owner}
                date={event.occurred_date ?? undefined}
                place={where(event.inside_zone, event.distance_m)}
                badge={<LinkEffectPill effect={event.effect} />}
                actions={controls(event)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
