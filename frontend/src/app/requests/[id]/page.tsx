"use client";

import { useParams } from "next/navigation";
import { useApiResource } from "@/hooks/useApiResource";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { EventDetailBody } from "@/components/event/EventDetailBody";
import { useEventActions } from "@/components/event/useEventActions";
import type { EventDetail } from "@/types";
import { PageError, PageLoading, PageShell } from "@/components/ui/PageShell";

/**
 * A request is a `requested` event (see `docs/data-model.md`, `events`) served by
 * `GET /events/{id}`; renders the shared `EventDetailBody` under the title, with
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
    <PageShell
      back
      title={request.title}
      subtitle={<AuthorByline author={request.owner} avatar />}
      stickyActions={actions}
      headerSide={side}
    >
      {panels}

      {/* No coordinates: no Location module, and the missing rows drop out. */}
      <EventDetailBody geo={request} variant="page" />
    </PageShell>
  );
}
