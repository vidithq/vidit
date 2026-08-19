"use client";

import { useParams } from "next/navigation";
import { useApiResource } from "@/hooks/useApiResource";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { EventDetailBody } from "@/components/event/EventDetailBody";
import { useEventActions } from "@/components/event/useEventActions";
import type { EventDetail } from "@/types";
import { PageError, PageLoading, PageShell } from "@/components/ui/PageShell";

/**
 * A request is a ``requested`` event (see ``docs/data-model.md`` → ``events``),
 * served by the same ``GET /events/{id}`` a located row uses; this page renders
 * the shared ``EventDetailBody`` under the shared action cluster. The request
 * surface is the one that carries all three tiers: the geolocate flow action,
 * the author's close, and the share and report utilities. ``useEventActions``
 * owns every one of them, so this page holds nothing of its own. Close captures
 * a required free-text reason via ``CloseEventForm``, shown as the Reason
 * beside the status badge, which is what tells a withdrawn request from a
 * rejected detection.
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
  // Called before the early returns, as every hook here must be.
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
        {/* The close and report forms, directly under the header where the
            triggers that opened them are. */}
        {panels}

        {/* A request is an event with no coordinates, so the body renders with
            an empty Location and the missing detected-from / requested-by rows
            simply drop out. */}
        <EventDetailBody geo={request} variant="page" />
    </PageShell>
  );
}
