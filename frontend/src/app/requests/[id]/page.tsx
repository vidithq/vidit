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
 * the Actions card (`useEventActions`: Edit, Share, Report, Geolocate) in the
 * rail, under the title on a phone. The owner closes it from the edit page.
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
  const { panels, rail } = useEventActions({
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
      rail={rail}
      railLabel="Actions"
      headerInColumn
    >
      {panels}

      {/* No coordinates: the Location is empty and the missing rows drop out. */}
      <EventDetailBody geo={request} variant="page" />
    </PageShell>
  );
}
