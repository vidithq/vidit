"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Trash2 } from "lucide-react";

import { CollectionDetailsForm } from "@/components/collections/CollectionDetailsForm";
import { Button, DANGER_CONFIRM } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PageError, PageLoading, PageShell } from "@/components/ui/PageShell";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { TEXT_LINK } from "@/components/ui/styles";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { useApiResource } from "@/hooks/useApiResource";
import { useConfirmAction } from "@/hooks/useConfirmAction";
import { useMutation } from "@/hooks/useMutation";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { errorMessage } from "@/lib/api";
import {
  addEventToCollection,
  collectionHref,
  deleteCollection,
  fetchCollectionSequence,
  removeEventFromCollection,
  updateCollection,
  type Collection,
} from "@/lib/collections";

/**
 * Owner edit of one collection: everything it carries, and the one act that
 * ends it.
 *
 * The form is the create page's, so both write pages ask for the same three
 * things: the title, the description, and the events on the shelf. The picker
 * opens on what the collection holds and the save writes the difference,
 * through the same idempotent membership routes the collection page's own
 * remove crosses take, which stay where they are: taking one item off while
 * reading is an act on that item, not a pass over the whole set.
 *
 * It is a page rather than a panel on the collection, the shape an owned event
 * already takes at `/events/{id}/edit`: the write has its own address, so a
 * reload keeps it, a link reaches it, and the collection page stays the reading
 * surface it is. Saving returns to the collection.
 *
 * **Dropping the collection lives at the bottom**, under its own eyebrow and
 * away from the fields, which is the one place on the site a destructive act on
 * the page's own subject belongs. It keeps the two-click confirm every
 * destructive control here takes, and the sentence above it says what survives,
 * since that is the part a reader hesitates over: the events it held stay
 * exactly as they are. Once the collection is gone the page hands the owner
 * back to their profile, where their other collections are.
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

  // What the collection holds when the form opens, so the picker starts on the
  // set the page is editing and the save has a baseline to diff against. The
  // page's own read of the sequence, the walk `<CollectionItems>` renders from
  // on the collection itself.
  const [itemIds, setItemIds] = useState<string[] | null>(null);
  const [itemsError, setItemsError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    fetchCollectionSequence(id, controller.signal)
      .then((walk) => {
        if (controller.signal.aborted) return;
        setItemIds(walk.items.map((item) => item.id));
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setItemsError(errorMessage(e, "Failed to read what this collection holds"));
      });
    return () => controller.abort();
  }, [id]);

  const save = useMutation(
    // The details first, then the memberships the picker moved, each through
    // the same idempotent route the collection page's own controls take. The
    // calls run in order and the first refusal stops the walk and is what the
    // banner says, so the analyst is told which act failed rather than being
    // handed a save that half happened without a word.
    async (title: string, description: string, eventIds: string[]) => {
      await updateCollection(id, title, description);
      const before = new Set(itemIds ?? []);
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

  const drop = useMutation(() => deleteCollection(id), {
    fallback: "Failed to drop the collection",
    onSuccess: () =>
      router.push(`/profile/${collection?.owner.username ?? ""}`),
  });

  // Two clicks, disarming on its own after a few seconds and on any click or
  // focus landing elsewhere: the same confirm every destructive control here
  // takes.
  const {
    armed: dropArmed,
    trigger: triggerDrop,
    controlRef: dropButtonRef,
  } = useConfirmAction(() => void drop.run(), {
    timeoutMs: 4000,
    dismissOnOutside: true,
  });

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
  // on an unknown set would open the edit with every current item unticked,
  // and the first save would strip the collection.
  if (itemIds === null) return <PageLoading />;

  return (
    <PageShell
      back
      backFallback={collectionHref(collection.id)}
      title="Edit collection"
      subtitle={collection.title}
    >
      <Card as="section">
        <SectionEyebrow title="Details" margin="none" />
        <CollectionDetailsForm
          username={user.username}
          initialTitle={collection.title}
          initialDescription={collection.description}
          initialEventIds={itemIds}
          submitLabel="Save collection"
          busy={save.loading}
          error={save.error}
          onSubmit={(title, description, eventIds) =>
            void save.run(title, description, eventIds)
          }
          onCancel={() => router.push(collectionHref(collection.id))}
        />
      </Card>

      <Card as="section">
        <SectionEyebrow title="Drop this collection" margin="none" />
        <p className="text-sm text-neutral-400">
          The events it holds stay exactly as they are. Only the collection
          goes, and it does not come back.
        </p>
        <Button
          ref={dropButtonRef}
          variant="danger"
          disabled={drop.loading}
          onClick={triggerDrop}
          className={dropArmed ? DANGER_CONFIRM : ""}
        >
          <Trash2 size={14} />
          {dropArmed
            ? "Confirm dropping this collection"
            : "Drop this collection"}
        </Button>
        {drop.error && <div className={FORM_ERROR_BANNER}>{drop.error}</div>}
      </Card>
    </PageShell>
  );
}
