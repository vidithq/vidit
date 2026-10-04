"use client";

import { useParams } from "next/navigation";

import type { EventDetail } from "@/types";
import { useApiResource } from "@/hooks/useApiResource";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { EventPageBody } from "@/components/event/EventPageBody";
import { useEventActions } from "@/components/event/useEventActions";
import { PageError, PageLoading, PageShell } from "@/components/ui/PageShell";
import { Pill } from "@/components/ui/Pill";

export default function EventPage() {
  const params = useParams();
  const eventId = typeof params.id === "string" ? params.id : "";
  const {
    data: geo,
    error,
    refetch,
  } = useApiResource<EventDetail>(eventId ? `/events/${eventId}` : null);
  // Geolocated events carry only the utilities tier plus, for the author, edit and close (which refetch). Called before early returns.
  const { actions, panels } = useEventActions({
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
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <AuthorByline author={geo.owner} avatar />
          {/* Version 1 says nothing. */}
          {geo.version_no > 1 && (
            <Pill tone="neutral" title={`Version ${geo.version_no}`}>
              v{geo.version_no}
            </Pill>
          )}
        </span>
      }
      actions={actions}
    >
        {/* Directly under the header, where the trigger that opened it is. */}
        {panels}

        <EventPageBody geo={geo} />
    </PageShell>
  );
}
