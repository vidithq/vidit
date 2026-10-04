"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

import { EventEditForm } from "@/components/geolocations/edit/EventEditForm";
import { RequestEditForm } from "@/components/geolocations/edit/RequestEditForm";
import { PageError, PageLoading, PageShell } from "@/components/ui/PageShell";
import { TEXT_LINK } from "@/components/ui/styles";
import { useApiResource } from "@/hooks/useApiResource";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import {
  detectionsReviewPath,
  detectionEditPath,
  QUEUE_PARAM,
  type PaginatedEventDetails,
} from "@/lib/events";
import type { EventDetail } from "@/types";

/**
 * Owner edit of one event: correcting an open request (`RequestEditForm`,
 * overwritten in place), confirming a detection, or correcting a published
 * geolocation (both `EventEditForm`). A `closed` row has no owner edit.
 *
 * With `?queue=1` the page is one step of a detections review walk over real
 * URLs: it places this detection in the owner's queue and hands the form the
 * position and the next address; past the last, the walk ends on the queue list.
 */
export default function EditEventPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useRequireAuth();
  const id = typeof params.id === "string" ? params.id : "";

  const { data: geo, error } = useApiResource<EventDetail>(
    user && id ? `/events/${id}` : null
  );

  // Read the queue only for a detection the owner asked to review.
  const inQueue = searchParams.get(QUEUE_PARAM) === "1";
  const isOwnDetection =
    !!geo && !!user && user.id === geo.owner.id && geo.status === "detected";
  const { data: queueData } = useApiResource<PaginatedEventDetails>(
    inQueue && isOwnDetection ? detectionsReviewPath() : null
  );

  if (authLoading || !user) {
    return <PageLoading />;
  }

  if (error) {
    return <PageError message={error} backHref="/map" />;
  }

  if (!geo) {
    return <PageLoading />;
  }

  // Writes are owner-only and state-gated (403 / 409); refuse before the form.
  if (user.id !== geo.owner.id) {
    // Open requests read at `/requests/{id}`, other rows at `/events/{id}`.
    const isRequest = geo.status === "requested";
    return (
      <PageShell back title="Edit event">
        <p className="text-sm text-neutral-400">
          You can only edit your own events.{" "}
          <Link
            href={isRequest ? `/requests/${geo.id}` : `/events/${geo.id}`}
            className={TEXT_LINK}
          >
            {isRequest ? "View this request" : "View this geolocation"}
          </Link>
          .
        </p>
      </PageShell>
    );
  }

  // An open request is overwritten in place (no version); answering it is the submit form's job (`/submit?request_id=`).
  if (geo.status === "requested") {
    return <RequestEditForm geo={geo} redirectTo={`/requests/${geo.id}`} />;
  }

  // What is left is `closed`, which no write reopens.
  if (geo.status !== "detected" && geo.status !== "geolocated") {
    return (
      <PageShell back title="Edit event">
        <p className="text-sm text-neutral-400">
          This event is {geo.status}, so it has no edit form.{" "}
          <Link
            href={`/events/${geo.id}`}
            className={TEXT_LINK}
          >
            View it
          </Link>
          .
        </p>
      </PageShell>
    );
  }

  // Return to the queue after a confirmation, the event after a version.
  const doneHref =
    geo.status === "geolocated"
      ? `/events/${geo.id}`
      : `/profile/${user.username}/detections`;

  // Position comes from the live queue; a detection it no longer holds gets a plain edit.
  const items = queueData?.items ?? [];
  const index = items.findIndex((e) => e.id === geo.id);
  const next = items[index + 1];
  const queue =
    index >= 0
      ? {
          position: `Detection ${index + 1} of ${queueData?.total ?? items.length}`,
          onAdvance: () =>
            router.push(next ? detectionEditPath(next.id, true) : doneHref),
        }
      : undefined;

  return (
    <EventEditForm geo={geo} redirectTo={doneHref} queue={queue} />
  );
}
