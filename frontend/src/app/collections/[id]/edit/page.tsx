"use client";

import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

import { CollectionDetailsForm } from "@/components/collections/CollectionDetailsForm";
import { PageError, PageLoading, PageShell } from "@/components/ui/PageShell";
import { TEXT_LINK } from "@/components/ui/styles";
import { useApiResource } from "@/hooks/useApiResource";
import { useCollectionSequence } from "@/hooks/useCollectionSequence";
import { useMutation } from "@/hooks/useMutation";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import {
  addEventToCollection,
  collectionHref,
  removeEventFromCollection,
  updateCollection,
  type Collection,
  type CollectionDescription,
} from "@/lib/collections";

/**
 * Owner edit of one collection, using the create page's form. The save writes the
 * difference from the opening set through the idempotent membership routes (one
 * `PUT` per row added, one `DELETE` per row removed). Dropping the collection
 * lives on the collection page. A non-owner gets the refusal before the form.
 */
export default function EditCollectionPage() {
  const params = useParams();
  const router = useRouter();
  const { user, loading: authLoading } = useRequireAuth();
  const id = typeof params.id === "string" ? params.id : "";

  const { data: collection, error } = useApiResource<Collection>(
    user && id ? `/collections/${id}` : null,
  );

  // Baseline for the picker's first block and the save diff, read like the collection page does.
  const { items, error: itemsError } = useCollectionSequence(id);

  const save = useMutation(
    // Details first, then memberships in order; the first refusal stops the walk and the banner names it.
    async (
      title: string,
      description: CollectionDescription,
      eventIds: string[],
    ) => {
      await updateCollection(id, title, description);
      const before = new Set((items ?? []).map((item) => item.id));
      const after = new Set(eventIds);
      for (const eventId of eventIds) {
        if (!before.has(eventId)) await addEventToCollection(id, eventId);
      }
      for (const eventId of before) {
        if (!after.has(eventId)) await removeEventFromCollection(id, eventId);
      }
    },
    {
      fallback: "Failed to save the collection",
      onSuccess: () => router.push(collectionHref(id)),
    },
  );

  if (authLoading || !user) return <PageLoading />;
  if (error) return <PageError message={error} backHref="/map" />;
  if (itemsError) return <PageError message={itemsError} backHref="/map" />;
  if (!collection) return <PageLoading />;

  // Writes are owner-only (backend 403); refuse before the form.
  if (user.id !== collection.owner.id) {
    return (
      <PageShell back title="Edit collection">
        <p className="text-sm text-neutral-400">
          You can only edit your own collections.{" "}
          <Link href={collectionHref(collection.id)} className={TEXT_LINK}>
            View this collection
          </Link>
          .
        </p>
      </PageShell>
    );
  }

  // The form seeds its picker once: mounting it on an unknown set would make the first save strip the collection.
  if (items === null) return <PageLoading />;

  return (
    <PageShell
      back
      backFallback={collectionHref(collection.id)}
      title="Edit collection"
    >
      <CollectionDetailsForm
        username={user.username}
        initialTitle={collection.title}
        initialDescription={collection.description}
        initialEvents={items}
        submitLabel="Save collection"
        busy={save.loading}
        error={save.error}
        onSubmit={(title, description, eventIds) =>
          void save.run(title, description, eventIds)
        }
        onCancel={() => router.push(collectionHref(collection.id))}
      />
    </PageShell>
  );
}
