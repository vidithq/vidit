"use client";

import { useParams } from "next/navigation";
import { useApiResource } from "@/hooks/useApiResource";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { eventPageSlots } from "@/components/event/EventDetailBody";
import { EventShell } from "@/components/event/EventShell";
import { useEventActions } from "@/components/event/useEventActions";
import type { EventDetail } from "@/types";
import { PageError, PageLoading } from "@/components/ui/PageShell";

/**
 * A request is a `requested` event (see `docs/data-model.md`, `events`) served by
 * `GET /events/{id}`; renders the shared `EventShell` and the event page's fields, with
 * the actions (`useEventActions`: Edit, Share, Report, then Geolocate) as the
 * page's sticky actions, top right. The owner closes it from the
 * edit page.
 */
export default function RequestDetailPage() {
  const params = useParams();
  const requestId = typeof params.id === "string" ? params.id : "";
  const {
    data: request,
    error,
    refetch,
  } = useApiResource<EventDetail>(
    requestId ? `/events/${requestId}` : null
  );
  // Called before the early returns.
  const { panels, actions, side } = useEventActions({
    event: request,
    surface: "request",
    onChanged: refetch,
  });

  if (error) {
    return (
      <PageError message={error} />
    );
  }
  if (!request) {
    return <PageLoading />;
  }

  return (
    <EventShell
      title={request.title}
      byline={<AuthorByline author={request.owner} avatar />}
      actions={actions}
      sideTop={side}
      panels={panels}
      // No coordinates: no Location module, and the missing rows drop out.
      body={eventPageSlots(request)}
    />
  );
}
