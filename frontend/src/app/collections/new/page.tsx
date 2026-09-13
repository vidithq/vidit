"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { CollectionDetailsForm } from "@/components/collections/CollectionDetailsForm";
import { Card } from "@/components/ui/Card";
import { PageLoading, PageShell } from "@/components/ui/PageShell";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { useMutation } from "@/hooks/useMutation";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import {
  addEventToCollection,
  collectionHref,
  createCollection,
  NEW_COLLECTION_EVENT_PARAM,
} from "@/lib/collections";

/**
 * Opening a collection: its own page, the address `/submit` is for an event.
 *
 * A collection is a thing an analyst names and describes, so the write gets a
 * page with the two fields on it rather than a panel that opens inside whatever
 * surface the analyst happened to be reading. Two surfaces send the reader
 * here, the profile's Collections section and the add-to-collection panel on an
 * event, and both hand over rather than growing a form of their own.
 *
 * `?event=<id>` is the second of those: the new collection receives that event
 * on the same act and the page returns to the event, so shelving an event on a
 * collection that does not exist yet is one trip away from the event and back.
 * Without it the page opens the collection it just created, which is where its
 * items are put on it.
 *
 * The page is behind the wall (`useRequireAuth`, the client-side bounce every
 * write sub-route under a public prefix takes), and both its exits, Cancel and
 * the header's Back, land where the reader came from.
 */
export default function NewCollectionPage() {
  // `useSearchParams` opts out of static prerender, so the body lives under a
  // Suspense boundary (the shape every other page reading the query takes).
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

  // Where the reader came from, and where both exits land: the event they were
  // shelving, or their own profile, which is where the section that offers this
  // page lives.
  const origin = eventId
    ? `/events/${encodeURIComponent(eventId)}`
    : `/profile/${encodeURIComponent(user?.username ?? "")}`;

  const create = useMutation(
    async (title: string, description: string) => {
      const collection = await createCollection(title, description);
      // The shelving is part of the same act, so a refusal here says so on
      // this page rather than landing the reader on an empty collection.
      if (eventId) await addEventToCollection(collection.id, eventId);
      return collection;
    },
    {
      fallback: "Failed to create the collection",
      onSuccess: (collection) =>
        router.push(eventId ? origin : collectionHref(collection.id)),
    },
  );

  if (loading || !user) return <PageLoading />;

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
      <Card as="section">
        <SectionEyebrow title="Details" margin="none" />
        <CollectionDetailsForm
          submitLabel={eventId ? "Create and add" : "Create collection"}
          hint="Say what the collection holds. Items order themselves by event date, so there is no order to set."
          busy={create.loading}
          error={create.error}
          onSubmit={(title, description) => void create.run(title, description)}
          onCancel={() => router.push(origin)}
        />
      </Card>
    </PageShell>
  );
}
