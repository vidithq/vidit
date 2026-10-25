"use client";

import { useParams } from "next/navigation";

import type { EventDetail } from "@/types";
import { useApiResource } from "@/hooks/useApiResource";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { eventPageSlots } from "@/components/event/EventDetailBody";
import { eventLocation } from "@/components/event/EventLocation";
import { EventShell } from "@/components/event/EventShell";
import { useEventActions } from "@/components/event/useEventActions";
import { PageError, PageLoading } from "@/components/ui/PageShell";
import { creditProps } from "@/lib/geolocatorCredit";

export default function EventPage() {
  const params = useParams();
  const eventId = typeof params.id === "string" ? params.id : "";
  const {
    data: geo,
    error,
    refetch,
  } = useApiResource<EventDetail>(eventId ? `/events/${eventId}` : null);
  // Called before the early returns.
  const { panels, actions } = useEventActions({
    event: geo,
    surface: "event",
    onChanged: refetch,
  });

  if (error)
    return (
      <PageError message={error} />
    );
  if (!geo) return <PageLoading />;

  return (
    <EventShell
      title={geo.title}
      byline={<AuthorByline {...creditProps(geo)} coAuthorsAs="avatars" avatar />}
      actions={actions}
      panels={panels}
      body={eventPageSlots(geo, eventLocation(geo))}
    />
  );
}
