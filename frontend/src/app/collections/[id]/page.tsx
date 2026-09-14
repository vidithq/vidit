"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Pencil, Trash2 } from "lucide-react";

import { CollectionItems } from "@/components/collections/CollectionItems";
import { CollectionMetaLine } from "@/components/collections/CollectionCard";
import { CollectionReader } from "@/components/collections/CollectionReader";
import { useReportContent } from "@/components/report/useReportContent";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { Button, buttonClasses, DANGER_CONFIRM } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PageError, PageLoading, PageShell } from "@/components/ui/PageShell";
import { Pill } from "@/components/ui/Pill";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { useAuth } from "@/contexts/AuthContext";
import { useApiResource } from "@/hooks/useApiResource";
import { useConfirmAction } from "@/hooks/useConfirmAction";
import { useMutation } from "@/hooks/useMutation";
import { errorMessage } from "@/lib/api";
import {
  collectionEditHref,
  CollectionIcon,
  collectionStepHref,
  deleteCollection,
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
 * The page is public, and so is the header cluster's first control: **Report**,
 * the red flag every detail surface carries, open to a reader with no account
 * because the person who notices a shelf misrepresenting what it holds is
 * rarely the person holding an account here. It opens the same panel an event
 * page opens (`useReportContent`), directly under the header.
 *
 * The owner's two controls come after it, in the slot every other surface puts
 * the controls that act on the thing the page is about. **Edit** opens the
 * collection's own edit page, where the details and the item picker live.
 * **Drop** is the red trash, under the two-click confirm every destructive
 * control on the site takes, and on success the owner lands on their profile
 * where their other collections are. The edit page keeps its own Drop card:
 * this one is the gesture an owner reaches for while reading the collection,
 * that one is the end of the page that rewrites it.
 *
 * Nothing else opens over the work the page shows: the item picker and the
 * per-row controls stay on the edit page.
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

  const { data: collection, error } = useApiResource<Collection>(
    id ? `/collections/${id}` : null,
  );

  // The collection's whole sequence, read once for the three sections. The
  // player has to say `N of M` and the list is what picks a step out of the
  // same set, so a page of items would leave the two counting differently;
  // `fetchCollectionSequence` follows the cursor to the end under its own
  // ceiling.
  const [sequence, setSequence] = useState<CollectionSequence | null>(null);
  const [sequenceError, setSequenceError] = useState<string | null>(null);

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
  }, [id]);

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

  // Its own state machine, called before the early returns like every hook
  // here: the flag works signed out, and the panel it opens renders under the
  // header where the trigger is.
  const report = useReportContent("collection", id);

  const drop = useMutation(() => deleteCollection(id), {
    fallback: "Failed to drop the collection",
    // Back to the owner's profile, where their other collections are: the page
    // they are on no longer exists.
    onSuccess: () => router.push(`/profile/${collection?.owner.username ?? ""}`),
  });

  // Two clicks, disarming on its own after a few seconds and on any click or
  // focus landing elsewhere: the confirm the edit page's Drop card takes, so
  // the same act asks the same way from both places.
  const {
    armed: dropArmed,
    trigger: triggerDrop,
    controlRef: dropButtonRef,
  } = useConfirmAction(() => void drop.run(), {
    timeoutMs: 4000,
    dismissOnOutside: true,
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
            <Pill tone="neutral" icon={<CollectionIcon size={11} />}>
              Collection
            </Pill>
          </span>
          <CollectionMetaLine collection={collection} className="text-xs" />
        </div>
      }
      actions={
        // `flex-wrap` plus `justify-end`, the event cluster's own row: it
        // breaks into stacked right-aligned lines on a phone instead of
        // pushing the header sideways.
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {report.trigger}
          {isOwner && (
            <>
              {/* Navigation, so the shape comes from `buttonClasses` on the
                  link rather than a button nested in an anchor. */}
              <Link
                href={collectionEditHref(collection.id)}
                className={buttonClasses("ghost", { icon: true })}
                aria-label="Edit this collection"
                title="Edit this collection"
              >
                <Pencil size={14} />
              </Link>
              <Button
                ref={dropButtonRef}
                icon
                variant="danger"
                disabled={drop.loading}
                onClick={triggerDrop}
                className={dropArmed ? DANGER_CONFIRM : ""}
                // The label is what says which click this is, since an icon
                // button has no text to swap.
                aria-label={
                  dropArmed
                    ? "Confirm dropping this collection"
                    : "Drop this collection"
                }
                title={
                  dropArmed
                    ? "Confirm dropping this collection"
                    : "Drop this collection"
                }
              >
                <Trash2 size={14} />
              </Button>
            </>
          )}
        </div>
      }
    >
      {/* Directly under the header, where the trigger that opened it is. */}
      {report.panel}
      {drop.error && (
        <div className={FORM_ERROR_BANNER} role="alert">
          {drop.error}
        </div>
      )}

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
        ownerUsername={collection.owner.username}
        items={items}
        isOwner={isOwner}
        loading={sequence === null && sequenceError === null}
        error={sequenceError}
        step={step}
        onStep={goToStep}
      />
    </PageShell>
  );
}
