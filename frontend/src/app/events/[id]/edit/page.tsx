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
  detectionEditPath,
  QUEUE_PARAM,
  type PaginatedEventDetails,
} from "@/lib/events";
import type { EventDetail } from "@/types";

/**
 * Owner edit of one event: confirming a machine detection, or correcting a
 * published geolocation. One address for both, since the fields are the same
 * form; `EventEditForm` reads the row's state and offers the write that state
 * allows. A row in any other state has no owner edit, so it says so and links
 * to the event.
 *
 * The page is also one step of a review pass over the detections queue when the
 * URL carries `?queue=1`.
 *
 * The flag makes a review a walk over real URLs rather than a session in
 * component state: each detection is its own address, so a reload keeps its place
 * and the browser's Back steps back one detection. The page reads the owner's queue
 * (the list the queue page reads), places this detection in it, and hands the form
 * the position plus where to go next. Past the last detection, the walk ends on the
 * queue list.
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

  // The queue is read only for a detection the viewer owns and asked to review, so
  // an ordinary edit costs no extra request.
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

  // Both writes are owner-only and state-gated, the same gates the backend
  // enforces (403 / 409). Surface them before the form rather than letting the
  // post bounce.
  if (user.id !== geo.owner.id) {
    return (
      <PageShell back title="Edit event">
        <p className="text-sm text-neutral-400">
          You can only edit your own events.{" "}
          <Link
            href={`/events/${geo.id}`}
            className={TEXT_LINK}
          >
            View this geolocation
          </Link>
          .
        </p>
      </PageShell>
    );
  }

  // A detection is confirmed here and a published geolocation is edited here.
  // The states in between are handled elsewhere: a `requested` event is
  // answered through the submit form, and a `closed` one is terminal.
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

  // Where the form returns to when it is done: the detections queue after a
  // confirmation, the event itself after a version.
  const doneHref =
    geo.status === "geolocated"
      ? `/events/${geo.id}`
      : `/profile/${user.username}/detections`;

  // The position is read off the live queue, so a detection published or rejected
  // a moment ago is out of both the count and the walk. A detection the queue no
  // longer holds carries no position: the page is a plain edit again.
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
