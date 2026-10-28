"use client";

import { Suspense, useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { CollectionDetailsForm } from "@/components/collections/CollectionDetailsForm";
import { PageError, PageLoading } from "@/components/ui/PageShell";
import { useApiResource } from "@/hooks/useApiResource";
import { useCursorList } from "@/hooks/useCursorList";
import { useMutation } from "@/hooks/useMutation";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { errorMessage } from "@/lib/api";
import {
  addEventsToCollection,
  clearSelectionHandoff,
  collectableEventsBody,
  collectableEventsPath,
  collectionHref,
  createCollection,
  NEW_COLLECTION_EVENT_PARAM,
  NEW_COLLECTION_SELECTION_PARAM,
  pickableFromDetail,
  readSelectionHandoff,
  type CollectionDescription,
} from "@/lib/collections";
import type { EventDetail, EventListItem } from "@/types";
import { eventHref, profileHref } from "@/lib/routes";

/**
 * Opens a collection. `?event=<id>` puts that event in the picker's first
 * block (it rides the create) and the page returns to the event; otherwise the
 * new collection opens. The form waits on the event read since it seeds its
 * blocks once. Behind `useRequireAuth`; both exits land where the reader came from.
 *
 * `?selection=<token>` names a search selection parked in `sessionStorage`
 * (`newCollectionFromSelectionHref`). Checked rows arrive as rows in the
 * handoff and seed the held card, removable like any pick, and ride the
 * create; the page reads no event for them. A search match fills the held card
 * a page at a time (`POST /collections/collectable-events`, the set the bulk add
 * shelves) behind **Show more**; a removed match joins `exclude_event_ids`, and
 * the match is added once the collection exists (`POST /collections/{id}/events`),
 * the server applying the cap and the ownership rule. A missing or stale token
 * opens the plain form.
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
  const checked = handoff && "eventIds" in handoff.target ? handoff.rows : null;
  const [heldCount, setHeldCount] = useState(checked?.length ?? 0);
  // Matches the reader took off the card: shown no more, and excluded from the add.
  const [excluded, setExcluded] = useState<string[]>([]);
  const matchPath = useCallback(
    (cursor: string | null) => (match ? collectableEventsPath(cursor) : null),
    [match],
  );
  const matchBody = useMemo(() => (match ? collectableEventsBody(match) : undefined), [match]);
  const matchWalk = useCursorList<EventListItem>(matchPath, undefined, undefined, matchBody);
  // What the save holds: the picks, plus the match less what was taken off it.
  const total = heldCount + (match && handoff ? handoff.count - excluded.length : 0);

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
          await addEventsToCollection(id, { match, excludeEventIds: excluded });
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
  if (eventError) return <PageError error={eventError} backHref={origin} />;
  // The form seeds once: mounting before the read lands would drop the event.
  if (eventId && !event) return <PageLoading />;

  return (
    <CollectionDetailsForm
      title="New collection"
      owner={user}
      backFallback={origin}
      username={user.username}
      initialEvents={event ? [pickableFromDetail(event)] : (checked ?? [])}
      submitLabel={
        eventId || ((match || checked) && total > 0) ? "Create and add" : "Create collection"
      }
      submitAction="newCollection"
      hint="Say what the collection holds. Items order themselves by event date, so there is no order to set."
      busy={create.loading}
      error={create.error}
      matched={
        match && handoff
          ? {
              rows: matchWalk.items.filter((row) => !excluded.includes(row.id)),
              total: handoff.count - excluded.length,
              walk: matchWalk,
              onRemove: (id) => setExcluded((ids) => (ids.includes(id) ? ids : [...ids, id])),
            }
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
