"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { CollectionDetailsForm } from "@/components/collections/CollectionDetailsForm";
import { PageError, PageLoading } from "@/components/ui/PageShell";
import { useApiResource } from "@/hooks/useApiResource";
import { useMutation } from "@/hooks/useMutation";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { errorMessage } from "@/lib/api";
import {
  addEventsToCollection,
  clearSelectionHandoff,
  collectionHref,
  createCollection,
  NEW_COLLECTION_EVENT_PARAM,
  NEW_COLLECTION_SELECTION_PARAM,
  pickableFromDetail,
  readSelectionHandoff,
  type CollectionDescription,
} from "@/lib/collections";
import { countLabel } from "@/lib/format";
import type { EventDetail } from "@/types";
import { eventHref, profileHref } from "@/lib/routes";

/**
 * Opens a collection. `?event=<id>` puts that event in the picker's first
 * block (it rides the create) and the page returns to the event; otherwise the
 * new collection opens. The form waits on the event read since it seeds its
 * blocks once. Behind `useRequireAuth`; both exits land where the reader came from.
 *
 * `?selection=<token>` names a search selection parked in `sessionStorage`
 * (`newCollectionFromSelectionHref`). Explicit ids ride the create with the
 * picked rows; a search match is added once the collection exists
 * (`POST /collections/{id}/events`), the server applying the cap and the
 * ownership rule. A missing or stale token opens the plain form.
 */
export default function NewCollectionPage() {
  // `useSearchParams` opts out of static prerender, so the body sits under Suspense.
  return (
    <Suspense fallback={<PageLoading />}>
      <NewCollectionPageBody />
    </Suspense>
  );
}

function NewCollectionPageBody() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading } = useRequireAuth();
  const eventId = searchParams.get(NEW_COLLECTION_EVENT_PARAM);
  const token = eventId ? null : searchParams.get(NEW_COLLECTION_SELECTION_PARAM);
  const handoff = useMemo(() => (token ? readSelectionHandoff(token) : null), [token]);
  // Set once the create lands, so a retry after a failed match add does not open a second one.
  const [createdId, setCreatedId] = useState<string | null>(null);

  // The `?event=` event for the picker's first block; skipped without the parameter.
  const { data: event, error: eventError } = useApiResource<EventDetail>(
    eventId ? `/events/${encodeURIComponent(eventId)}` : null,
  );

  // Where both exits land: the event being shelved, the search a selection came from, else the
  // reader's profile.
  const origin = eventId
    ? eventHref(eventId)
    : (handoff?.from ?? profileHref(user?.username ?? ""));

  const create = useMutation(
    // Picked events and explicit selection ids ride the create, so a refusal on any of them
    // shows here and no collection opens.
    async (title: string, description: CollectionDescription, eventIds: string[]) => {
      const target = handoff?.target;
      const ids =
        target && "eventIds" in target
          ? [...new Set([...eventIds, ...target.eventIds])]
          : eventIds;
      const id = createdId ?? (await createCollection(title, description, ids)).id;
      setCreatedId(id);
      if (target && "match" in target) {
        try {
          await addEventsToCollection(id, { match: target.match });
        } catch (err) {
          throw new Error(
            `The collection is created, but the geolocations were not added: ${errorMessage(err)}`,
          );
        }
      }
      return id;
    },
    {
      fallback: "Failed to create the collection",
      onSuccess: (id) => {
        if (token) clearSelectionHandoff(token);
        router.push(eventId ? origin : collectionHref(id));
      },
    },
  );

  if (loading || !user) return <PageLoading />;
  if (eventError) return <PageError message={eventError} backHref={origin} />;
  // The form seeds once: mounting before the read lands would drop the event.
  if (eventId && !event) return <PageLoading />;

  return (
    <CollectionDetailsForm
      title="New collection"
      subtitle={
        eventId
          ? "The collection opens with this event on it."
          : handoff
            ? `The collection opens with the ${countLabel(handoff.count, "geolocation")} you selected.`
            : "A named set of your own events, shown on your profile."
      }
      backFallback={origin}
      username={user.username}
      initialEvents={event ? [pickableFromDetail(event)] : []}
      submitLabel={eventId || handoff ? "Create and add" : "Create collection"}
      hint="Say what the collection holds. Items order themselves by event date, so there is no order to set."
      busy={create.loading}
      error={create.error}
      selection={
        handoff ? `${countLabel(handoff.count, "geolocation")} will be added.` : undefined
      }
      onSubmit={(title, description, eventIds) =>
        void create.run(title, description, eventIds)
      }
      onCancel={() => router.push(origin)}
    />
  );
}
