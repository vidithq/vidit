"use client";

import { useParams } from "next/navigation";

import type { EventDetail } from "@/types";
import { useApiResource } from "@/hooks/useApiResource";
import { creditProps } from "@/lib/geolocatorCredit";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { PageError, PageLoading } from "@/components/ui/PageShell";
import { eventPageSlots } from "@/components/event/EventDetailBody";
import { eventLocation } from "@/components/event/EventLocation";
import { EventShell } from "@/components/event/EventShell";
import { useEventActions, type ActionSurface } from "@/components/event/useEventActions";

/** An event's page byline, from the row: the owner, then every co-geolocator as a picture. */
export function EventByline({ event }: { event: Pick<EventDetail, "owner" | "geolocators"> }) {
  return <AuthorByline {...creditProps(event)} coAuthorsAs="avatars" avatar />;
}

/**
 * The read page of one row at `/events/{id}` or `/requests/{id}`: `EventShell` filled from
 * `GET /events/{id}`, the actions of `useEventActions` for the surface, the body of
 * `eventPageSlots`. A request carries no Location module, since its coordinates are a guess, and
 * no Sites block.
 */
export function EventReadPage({ surface }: { surface: ActionSurface }) {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const { data: geo, error, refetch } = useApiResource<EventDetail>(id ? `/events/${id}` : null);
  // Called before the early returns.
  const { panels, actions, sites } = useEventActions({ event: geo, surface, onChanged: refetch });

  if (error) return <PageError error={error} onRetry={refetch} />;
  if (!geo) return <PageLoading />;

  return (
    <EventShell
      title={geo.title}
      byline={<EventByline event={geo} />}
      actions={actions}
      panels={panels}
      body={
        surface === "event"
          ? { ...eventPageSlots(geo, eventLocation(geo)), sites }
          : eventPageSlots(geo, null)
      }
    />
  );
}
