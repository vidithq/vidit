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
} from "@/lib/collections";
import type { EventDetail } from "@/types";

/**
 * Opening a collection: its own page, the address `/submit` is for an event.
 *
 * A collection is a thing an analyst names and describes, so the write gets a
 * page with the two fields on it rather than a panel that opens inside whatever
 * surface the analyst happened to be reading. Two surfaces send the reader
 * here, the profile's Collections section and the add-to-collection panel on an
 * event, and both hand over rather than growing a form of their own.
 *
 * `?event=<id>` is the second of those: the event arrives on the picker's
 * first block, so it rides the create like every other row the analyst adds,
 * and the page returns to the event, which makes shelving on a collection that
 * does not exist yet one trip away from the event and back. Without it the
 * page opens the collection it just created. The event is read here (the row
 * the block renders is the catalogue card's, which needs the event and not
 * only its id) and the form waits on that read, since it seeds its blocks
 * once.
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

  // The one event a `?event=` link carries, as the picker's first block
  // renders it. Skipped entirely without the parameter.
  const { data: event, error: eventError } = useApiResource<EventDetail>(
    eventId ? `/events/${encodeURIComponent(eventId)}` : null,
  );

  // Where the reader came from, and where both exits land: the event they were
  // shelving, or their own profile, which is where the section that offers this
  // page lives.
  const origin = eventId
    ? `/events/${encodeURIComponent(eventId)}`
    : `/profile/${encodeURIComponent(user?.username ?? "")}`;

  const create = useMutation(
    // One request: the picked events ride the create, so a refusal on any of
    // them says so on this page rather than landing the reader on a
    // collection holding part of what they picked.
    (title: string, description: string, eventIds: string[]) =>
      createCollection(title, description, eventIds),
    {
      fallback: "Failed to create the collection",
      onSuccess: (collection) =>
        router.push(eventId ? origin : collectionHref(collection.id)),
    },
  );

  if (loading || !user) return <PageLoading />;
  if (eventError) return <PageError message={eventError} backHref={origin} />;
  // The form seeds its blocks once, so it waits on the event: mounting it
  // before the read lands would open the collection holding nothing, and the
  // create would drop the event the analyst was shelving.
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
