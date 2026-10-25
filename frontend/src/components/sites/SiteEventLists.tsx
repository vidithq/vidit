"use client";

import { Link2, MapPin } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { LinkRow } from "@/components/ui/LinkRow";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { formatDate } from "@/lib/format";
import { eventHref } from "@/lib/routes";
import {
  SITE_MARGIN_KM,
  formatDistance,
  type SiteLinkedEvent,
  type SiteNearbyEvent,
} from "@/lib/sites";
import { LinkEffectPill } from "./SiteBadges";

function where(insideZone: boolean, distance: number | null): string {
  if (insideZone || distance === null || distance === 0) return "Inside the zone";
  return `${formatDistance(distance)} outside the zone`;
}

/** The Linked events view: one row per event, its effect, date, owner and where it lies against
 *  the contour it was measured against. Each row opens the event. */
export function LinkedEventRows({ events }: { events: SiteLinkedEvent[] }) {
  if (events.length === 0) {
    return (
      <EmptyState>
        No event is linked yet. The author of an event links it from the event page or from here.
      </EmptyState>
    );
  }
  return (
    <ul className="space-y-2">
      {events.map((event) => (
        <li key={event.id}>
          <LinkRow
            icon={MapPin}
            variant="arrow"
            external={false}
            href={eventHref(event.id)}
            value={event.title}
            meta={
              <>
                <LinkEffectPill effect={event.effect} />
                <span>{event.occurred_date ? formatDate(event.occurred_date) : "Undated"}</span>
                <span>{event.owner.username}</span>
                <span>{where(event.inside_zone, event.distance_m)}</span>
              </>
            }
          />
        </li>
      ))}
    </ul>
  );
}

/**
 * Nearby events, not linked: a spatial computation, kept apart from the links. The reader's
 * own events carry **Link**, which opens the link dialog on that event.
 */
export function NearbyEvents({
  events,
  error,
  viewerId,
  onLink,
}: {
  events: SiteNearbyEvent[] | null;
  error: string | null;
  viewerId: string | null;
  onLink: (event: SiteNearbyEvent) => void;
}) {
  return (
    <section>
      <SectionEyebrow title="Nearby events, not linked" concept="site_nearby" />
      <p className="mb-3 text-sm text-neutral-400">
        Computed from position alone: published events within {SITE_MARGIN_KM} km of the current
        zone that nobody has linked to this site.
      </p>
      {error ? (
        <EmptyState>{error}</EmptyState>
      ) : events === null ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : events.length === 0 ? (
        <EmptyState>No unlinked event within {SITE_MARGIN_KM} km.</EmptyState>
      ) : (
        <ul className="space-y-2">
          {events.map((event) => (
            <li key={event.id}>
              <LinkRow
                icon={MapPin}
                variant="arrow"
                external={false}
                href={eventHref(event.id)}
                value={event.title}
                meta={
                  <>
                    <span>{event.occurred_date ? formatDate(event.occurred_date) : "Undated"}</span>
                    <span>{event.owner.username}</span>
                    <span>
                      {event.distance_m === 0
                        ? "Inside the zone"
                        : `${formatDistance(event.distance_m)} from the zone`}
                    </span>
                  </>
                }
                action={
                  event.owner.id === viewerId && (
                    <Button variant="secondary" onClick={() => onLink(event)}>
                      <Link2 size={14} />
                      Link
                    </Button>
                  )
                }
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
