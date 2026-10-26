"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
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
  fetchPickableEvents,
  NEW_COLLECTION_EVENT_PARAM,
  NEW_COLLECTION_SELECTION_PARAM,
  pickableFromDetail,
  readSelectionHandoff,
  type CollectionDescription,
  type PickableEvent,
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
 * (`newCollectionFromSelectionHref`). Checked rows (explicit ids) load into the
 * held card (`fetchPickableEvents`), removable like any pick, and ride the
 * create. A search match keeps a *From your search* count card and is added
 * once the collection exists (`POST /collections/{id}/events`), the server
 * applying the cap and the ownership rule. A missing or stale token opens the
 * plain form.
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
  const match = handoff && "match" in handoff.target ? handoff.target.match : null;
  const selectedIds = handoff && "eventIds" in handoff.target ? handoff.target.eventIds : null;
  const [loaded, setLoaded] = useState<{ rows: PickableEvent[]; dropped: number } | null>(null);
  const [heldCount, setHeldCount] = useState(0);

  useEffect(() => {
    if (!selectedIds) return;
    const controller = new AbortController();
    fetchPickableEvents(selectedIds, controller.signal)
      .then(setLoaded)
      // Aborted by a remount: the next run loads them.
      .catch(() => {});
    return () => controller.abort();
  }, [selectedIds]);

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
    // The held rows, a loaded selection's included, ride the create, so a refusal on any of them
    // shows here and no collection opens.
    async (title: string, description: CollectionDescription, eventIds: string[]) => {
      const id = createdId ?? (await createCollection(title, description, eventIds)).id;
      setCreatedId(id);
      if (match) {
        try {
          await addEventsToCollection(id, { match });
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
          : match && handoff
            ? `The collection opens with the ${countLabel(handoff.count, "geolocation")} you selected.`
            : selectedIds && !loaded
              ? "Loading the geolocations you selected."
              : selectedIds && heldCount > 0
                ? `The collection opens with ${countLabel(heldCount, "geolocation")}.`
                : "A named set of your own events, shown on your profile."
      }
      backFallback={origin}
      username={user.username}
      initialEvents={event ? [pickableFromDetail(event)] : []}
      submitLabel={
        eventId || match || (selectedIds && heldCount > 0) ? "Create and add" : "Create collection"
      }
      hint="Say what the collection holds. Items order themselves by event date, so there is no order to set."
      busy={create.loading}
      error={create.error}
      selection={
        match && handoff ? `${countLabel(handoff.count, "geolocation")} will be added.` : undefined
      }
      pendingEvents={selectedIds ? (loaded?.rows ?? null) : undefined}
      heldNote={
        loaded && loaded.dropped > 0
          ? `${countLabel(loaded.dropped, "selected geolocation")} could not be added: deleted, or no longer one a collection can hold.`
          : undefined
      }
      onEventsChange={setHeldCount}
      onSubmit={(title, description, eventIds) =>
        void create.run(title, description, eventIds)
      }
      onCancel={() => router.push(origin)}
    />
  );
}
