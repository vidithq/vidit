"use client";

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
import {
  collectionHref,
  deleteCollection,
  updateCollection,
  type Collection,
} from "@/lib/collections";

/**
 * Owner edit of one collection: the two details it carries, and the one act
 * that ends it.
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

  const save = useMutation(
    (title: string, description: string) =>
      updateCollection(id, title, description),
    {
      fallback: "Failed to save the collection's details",
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
  if (!collection) return <PageLoading />;

  // Every write below is owner-only, the gate the backend enforces with a 403.
  // Surface it before the form rather than letting the save bounce.
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
          initialTitle={collection.title}
          initialDescription={collection.description}
          submitLabel="Save details"
          busy={save.loading}
          error={save.error}
          onSubmit={(title, description) => void save.run(title, description)}
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
