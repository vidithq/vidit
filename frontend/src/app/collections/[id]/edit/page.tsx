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
} from "@/lib/collections";

/**
 * Owner edit of one collection: everything it carries.
 *
 * The form is the create page's, so both write pages ask for the same three
 * things: the title, the description, and the events on the shelf. The picker
 * opens holding what the collection holds and the save writes the difference,
 * through the same idempotent membership routes: one `PUT` per row added and
 * one `DELETE` per row taken off. This is the one place an item leaves a
 * collection; the collection's own page only reads the set.
 *
 * It is a page rather than a panel on the collection, the shape an owned event
 * already takes at `/events/{id}/edit`: the write has its own address, so a
 * reload keeps it, a link reaches it, and the collection page stays the reading
 * surface it is. Saving returns to the collection. The page carries no
 * subtitle naming the collection, the event edit page's own answer: the Title
 * field already says it.
 *
 * Dropping the collection lives on the collection page's own header, not here:
 * this page is Details and Events only, and a destructive act on the page's
 * own subject belongs where the owner reads it, not where they rewrite it.
 *
 * A reader who does not own the collection gets the event edit page's own
 * answer: the refusal the backend would give, stated before the form rather
 * than after a bounced write, with the way to the collection itself.
 */
export default function EditCollectionPage() {
  const params = useParams();
  const router = useRouter();
  const { user, loading: authLoading } = useRequireAuth();
  const id = typeof params.id === "string" ? params.id : "";

  const { data: collection, error } = useApiResource<Collection>(
    user && id ? `/collections/${id}` : null,
  );

  // What the collection holds when the form opens, so the picker's first block
  // opens on the set the page is editing and the save has a baseline to diff
  // against. The same walk the collection's own page reads, rows and all: the
  // block renders the catalogue card for each of them.
  const { items, error: itemsError } = useCollectionSequence(id);

  const save = useMutation(
    // The details first, then the memberships the picker moved, each through
    // the same idempotent route the collection page's own controls take. The
    // calls run in order and the first refusal stops the walk and is what the
    // banner says, so the analyst is told which act failed rather than being
    // handed a save that half happened without a word.
    async (title: string, description: string, eventIds: string[]) => {
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

  // Every write below is owner-only, the gate the backend enforces with a 403.
  // Surface it before the form rather than letting the save bounce, and before
  // the wait below, since a reader who may not edit has nothing to wait for.
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

  // The form seeds its picker once, so it waits on the items read: mounting it
  // on an unknown set would open the edit holding nothing, and the first save
  // would strip the collection.
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
