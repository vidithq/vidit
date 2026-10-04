"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { CollectionDetailsForm } from "@/components/collections/CollectionDetailsForm";
import { PageError, PageLoading, PageShell } from "@/components/ui/PageShell";
import { useApiResource } from "@/hooks/useApiResource";
import { useMutation } from "@/hooks/useMutation";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import {
  collectionHref,
  createCollection,
  NEW_COLLECTION_EVENT_PARAM,
  pickableFromDetail,
  type CollectionDescription,
} from "@/lib/collections";
import type { EventDetail } from "@/types";

/**
 * Opens a collection. `?event=<id>` puts that event in the picker's first
 * block (it rides the create) and the page returns to the event; otherwise the
 * new collection opens. The form waits on the event read since it seeds its
 * blocks once. Behind `useRequireAuth`; both exits land where the reader came from.
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

  // The `?event=` event for the picker's first block; skipped without the parameter.
  const { data: event, error: eventError } = useApiResource<EventDetail>(
    eventId ? `/events/${encodeURIComponent(eventId)}` : null,
  );

  // Where both exits land: the event being shelved, else the reader's profile.
  const origin = eventId
    ? `/events/${encodeURIComponent(eventId)}`
    : `/profile/${encodeURIComponent(user?.username ?? "")}`;

  const create = useMutation(
    // One request: picked events ride the create, so a refusal on any of them shows here.
    (title: string, description: CollectionDescription, eventIds: string[]) =>
      createCollection(title, description, eventIds),
    {
      fallback: "Failed to create the collection",
      onSuccess: (collection) =>
        router.push(eventId ? origin : collectionHref(collection.id)),
    },
  );

  if (loading || !user) return <PageLoading />;
  if (eventError) return <PageError message={eventError} backHref={origin} />;
  // The form seeds once: mounting before the read lands would drop the event.
  if (eventId && !event) return <PageLoading />;

  return (
    <PageShell
      back
      backFallback={origin}
      title="New collection"
      subtitle={
        eventId
          ? "The collection opens with this event on it."
          : "A named set of your own events, shown on your profile."
      }
    >
      <CollectionDetailsForm
        username={user.username}
        initialEvents={event ? [pickableFromDetail(event)] : []}
        submitLabel={eventId ? "Create and add" : "Create collection"}
        hint="Say what the collection holds. Items order themselves by event date, so there is no order to set."
        busy={create.loading}
        error={create.error}
        onSubmit={(title, description, eventIds) =>
          void create.run(title, description, eventIds)
        }
        onCancel={() => router.push(origin)}
      />
    </PageShell>
  );
}
