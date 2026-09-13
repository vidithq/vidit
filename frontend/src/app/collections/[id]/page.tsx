"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Layers } from "lucide-react";

import { CollectionItems } from "@/components/collections/CollectionItems";
import { CollectionMetaLine } from "@/components/collections/CollectionCard";
import { CollectionReader } from "@/components/collections/CollectionReader";
import { useCollectionActions } from "@/components/collections/useCollectionActions";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { Card } from "@/components/ui/Card";
import { PageError, PageLoading, PageShell } from "@/components/ui/PageShell";
import { Pill } from "@/components/ui/Pill";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { useAuth } from "@/contexts/AuthContext";
import { useApiResource } from "@/hooks/useApiResource";
import { errorMessage } from "@/lib/api";
import {
  collectionStepHref,
  fetchCollectionSequence,
  readerStep,
  type Collection,
  type CollectionSequence,
} from "@/lib/collections";

/**
 * One collection: what it is, where its items are, and what they are.
 *
 * The header is the collection itself, the grammar the event page uses for an
 * event: the title, the owner's byline under it with a `Collection` pill saying
 * what kind of page this is, and the meta line the profile card prints beside
 * the mosaic. The mosaic itself is the profile card's picture and nothing else:
 * the page opens on the name of the collection rather than on a band the width
 * of the page.
 *
 * Then three sections, each a `Card` under its own eyebrow. **Description** is
 * what the owner says the collection holds, at reading size and whole, where
 * the card clamps it to two lines; it is a section rather than a header line
 * because a description runs to 500 characters and the header is the identity
 * of the page, not its content. **Coverage** is the player: the items on the
 * map with the current one lit, and that item's event in the map page's own
 * panel beside it. **Events** is the chronological list, where the row the
 * player stands on is lit and a click on a row moves the player to it.
 *
 * All three read one set, the sequence this page walks once, so the pins, the
 * panel and the rows can never describe different collections.
 *
 * The page is public. The owner's two verbs (the title and dropping the
 * collection) ride the header cluster with their panels under it, which is
 * where every other surface puts the controls that act on the thing the page is
 * about.
 */
export default function CollectionPage() {
  // `useSearchParams` opts out of static prerender, so the body lives under a
  // Suspense boundary (the shape every other page reading the query takes).
  return (
    <Suspense fallback={<PageLoading />}>
      <CollectionPageBody />
    </Suspense>
  );
}

function CollectionPageBody() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const id = typeof params.id === "string" ? params.id : "";

  const {
    data: collection,
    error,
    refetch,
  } = useApiResource<Collection>(id ? `/collections/${id}` : null);

  // The collection's whole sequence, read once for the three sections. The
  // player has to say `N of M` and the list is what picks a step out of the
  // same set, so a page of items would leave the two counting differently;
  // `fetchCollectionSequence` follows the cursor to the end under its own
  // ceiling. `reloads` re-runs the walk after the owner takes an item off.
  const [sequence, setSequence] = useState<CollectionSequence | null>(null);
  const [sequenceError, setSequenceError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    fetchCollectionSequence(id, controller.signal)
      .then((walk) => {
        if (controller.signal.aborted) return;
        setSequence(walk);
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setSequenceError(errorMessage(e, "Failed to read this collection"));
      });
    return () => controller.abort();
  }, [id, reloads]);

  const items = sequence?.items ?? [];
  // Clamped at read time, so a link to a step the collection no longer holds
  // opens on its nearest real one and taking the current item off the shelf
  // lands on whatever is nearest to where the reader was, with no write to the
  // URL to do it.
  const step = readerStep(searchParams.get("step"), items.length);

  const goToStep = useCallback(
    (next: number) => {
      // `replace`, not `push`: stepping through a collection is reading one
      // page, so the browser's back button leaves the page rather than walking
      // back through every step taken on it. `scroll: false` keeps the reader
      // where they picked the step, which on the list is below the player.
      router.replace(collectionStepHref(id, next), { scroll: false });
    },
    [id, router],
  );

  const isOwner = !!user && !!collection && user.id === collection.owner.id;

  // Called before the early returns, as every hook here must be.
  const { actions, panels } = useCollectionActions({
    collection,
    isOwner,
    onChanged: refetch,
    onDeleted: () =>
      router.push(`/profile/${collection?.owner.username ?? ""}`),
  });

  if (error) return <PageError message={error} backHref="/map" />;
  if (!collection) return <PageLoading />;

  return (
    <PageShell
      back
      title={collection.title}
      subtitle={
        <div className="space-y-1">
          <span className="flex flex-wrap items-center gap-2">
            <AuthorByline author={collection.owner} avatar />
            {/* What kind of page this is. A collection's title reads like an
                event's, and the two pages share a shape, so the row says which
                one the reader is on. */}
            <Pill tone="neutral" icon={<Layers size={11} />}>
              Collection
            </Pill>
          </span>
          <CollectionMetaLine collection={collection} className="text-xs" />
        </div>
      }
      actions={actions}
    >
      {/* Directly under the header, where the trigger that opened it is. */}
      {panels}

      <Card as="section">
        <SectionEyebrow title="Description" margin="none" />
        {/* `whitespace-pre-line` keeps the paragraph breaks the owner typed;
            the text is plain, so nothing else of what they wrote is
            rendered. */}
        <p className="whitespace-pre-line text-sm text-neutral-300">
          {collection.description}
        </p>
      </Card>

      {/* A collection with nothing on it has nothing to step through, and the
          list below says so in its own words. */}
      {items.length > 0 && (
        <CollectionReader
          items={items}
          capped={sequence?.capped ?? false}
          step={step}
          onStep={goToStep}
        />
      )}

      <CollectionItems
        collectionId={collection.id}
        items={items}
        isOwner={isOwner}
        loading={sequence === null && sequenceError === null}
        error={sequenceError}
        step={step}
        onStep={goToStep}
        onRemoved={() => {
          // The header's count and date range both move with the set, and the
          // sequence the three sections read is a set that just changed.
          refetch();
          setReloads((n) => n + 1);
        }}
      />
    </PageShell>
  );
}
