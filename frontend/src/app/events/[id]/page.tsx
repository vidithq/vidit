"use client";

import { useParams } from "next/navigation";

import type { EventDetail } from "@/types";
import { useApiResource } from "@/hooks/useApiResource";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { EventPageBody } from "@/components/event/EventPageBody";
import { EventSitesBlock } from "@/components/sites/EventSitesBlock";
import { useEventActions } from "@/components/event/useEventActions";
import { PageError, PageLoading, PageShell } from "@/components/ui/PageShell";
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
  const { panels, rail } = useEventActions({
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
    <PageShell
      back
      title={geo.title}
      subtitle={<AuthorByline {...creditProps(geo)} coAuthorsAs="avatars" avatar />}
      rail={rail}
      railLabel="Actions and approvals"
      headerInColumn
    >
      {panels}
      <EventPageBody geo={geo} sites={<EventSitesBlock event={geo} />} />
    </PageShell>
  );
}
