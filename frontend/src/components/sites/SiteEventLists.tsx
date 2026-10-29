"use client";

import { Item } from "@/components/ui/Item";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { eventItem } from "@/lib/items";
import { formatDistance, sortLinkedEvents, type SiteLinkedEvent } from "@/lib/sites";
import { LinkEffectPill } from "./SiteBadges";

function where(insideZone: boolean, distance: number | null): string {
  if (insideZone || distance === null || distance === 0) return "Inside the zone";
  return `${formatDistance(distance)} outside the zone`;
}

/**
 * The site page's Linked events section, newest event date first: one list `<Item>` per event,
 * with where it lies against the contour it was measured against as its place, and its effect
 * as its badge, since every linked event is geolocated. Nothing renders while no event is
 * linked.
 */
export function LinkedEvents({ events }: { events: SiteLinkedEvent[] }) {
  if (events.length === 0) return null;
  return (
    <section>
      <SectionEyebrow title={`Linked events (${events.length})`} concept="site_linked_events" />
      <ul className="space-y-2">
        {sortLinkedEvents(events).map((event) => (
          <li key={event.id}>
            <Item
              variant="list"
              {...eventItem({ ...event, status: "geolocated" })}
              place={where(event.inside_zone, event.distance_m)}
              badge={<LinkEffectPill effect={event.effect} />}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
