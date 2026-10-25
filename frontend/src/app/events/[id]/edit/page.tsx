"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

import { EventEditForm } from "@/components/geolocations/edit/EventEditForm";
import { PageError, PageLoading, PageShell } from "@/components/ui/PageShell";
import { TEXT_LINK } from "@/components/ui/styles";
import { useApiResource } from "@/hooks/useApiResource";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import {
  detectionsReviewPath,
  type PaginatedEventDetails,
} from "@/lib/events";
import type { EventDetail } from "@/types";
import {
  detectionsQueueHref,
  eventEditHref,
  eventHref,
  QUEUE_PARAM,
  requestHref,
} from "@/lib/routes";

/**
 * The edit of one event, `EventEditForm` in every shape: publishing a request
 * or a detection, or correcting a published geolocation. A detection and a
 * published row are their owner's; a request is anyone's to publish, and its
 * owner's to save in place. A `closed` row has no edit.
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

  const { data: geo, error, refetch } = useApiResource<EventDetail>(
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

  const isOwner = user.id === geo.owner.id;

  // Writes are state-gated (409) and, past an open request, owner-only (403); refuse before the
  // form.
  if (!isOwner && geo.status !== "requested") {
    return (
      <PageShell back title="Edit event">
        <p className="text-sm text-neutral-400">
          You can only edit your own events.{" "}
          <Link href={eventHref(geo.id)} className={TEXT_LINK}>
            View this event
          </Link>
          .
        </p>
      </PageShell>
    );
  }

  // An open request publishes to its event page; its in-place save and its close return to it.
  if (geo.status === "requested") {
    return <EventEditForm geo={geo} redirectTo={requestHref(geo.id)} isOwner={isOwner} />;
  }

  // What is left is `closed`, which no write reopens.
  if (geo.status !== "detected" && geo.status !== "geolocated") {
    return (
      <PageShell back title="Edit event">
        <p className="text-sm text-neutral-400">
          This event is {geo.status}, so it has no edit form.{" "}
          <Link
            href={eventHref(geo.id)}
            className={TEXT_LINK}
          >
            View it
          </Link>
          .
        </p>
      </PageShell>
    );
  }

  // Return to the queue after a publish, the event after a version.
  const doneHref =
    geo.status === "geolocated"
      ? eventHref(geo.id)
      : detectionsQueueHref(user.username);

  // Position comes from the live queue; a detection it no longer holds gets a plain edit.
  const items = queueData?.items ?? [];
  const index = items.findIndex((e) => e.id === geo.id);
  const next = items[index + 1];
  const queue =
    index >= 0
      ? {
          position: `Detection ${index + 1} of ${queueData?.total ?? items.length}`,
          onAdvance: () =>
            router.push(next ? eventEditHref(next.id, true) : doneHref),
        }
      : undefined;

  return (
    <EventEditForm
      geo={geo}
      redirectTo={doneHref}
      isOwner
      queue={queue}
      onCreditChanged={refetch}
    />
  );
}
