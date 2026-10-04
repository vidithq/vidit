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
 * `GET /events/{id}`; renders the shared `EventDetailBody` under the shared
 * action cluster (`useEventActions` owns all four tiers). Close captures a
 * required reason via `CloseEventForm`, shown beside the status badge.
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
  const { actions, panels } = useEventActions({
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
      actions={actions}
    >
        {/* Close and report forms sit under the header, where their triggers are. */}
        {panels}

        {/* No coordinates: the Location is empty and the missing rows drop out. */}
        <EventDetailBody geo={request} variant="page" />
    </PageShell>
  );
}
