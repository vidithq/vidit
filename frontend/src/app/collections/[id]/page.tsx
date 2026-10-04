"use client";

import { Suspense, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Pencil, Trash2 } from "lucide-react";

import { CollectionItems } from "@/components/collections/CollectionItems";
import {
  CollectionMetaLine,
  CollectionTags,
} from "@/components/collections/CollectionCard";
import { CollectionReader } from "@/components/collections/CollectionReader";
import { useReportContent } from "@/components/report/useReportContent";
import ShareOnX from "@/components/share/ShareOnX";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { Button, buttonClasses, DANGER_CONFIRM } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PageError, PageLoading, PageShell } from "@/components/ui/PageShell";
import { Pill } from "@/components/ui/Pill";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { useAuth } from "@/contexts/AuthContext";
import { useApiResource } from "@/hooks/useApiResource";
import { useCollectionSequence } from "@/hooks/useCollectionSequence";
import { useConfirmAction } from "@/hooks/useConfirmAction";
import { useMutation } from "@/hooks/useMutation";
import {
  collectionEditHref,
  collectionHref,
  CollectionIcon,
  collectionMetaSegments,
  collectionStepHref,
  deleteCollection,
  readerStep,
  type Collection,
} from "@/lib/collections";
import { renderProof } from "@/lib/proof";

/**
 * One collection page: the header (title, owner byline with a `Collection` pill, the profile
 * card's meta line, the tags its items carry), then three `Card` sections. **Description** is
 * the owner's text at reading size, rendered through `renderProof` (the card clamps its
 * plain-text projection instead). **Coverage** is the player: items on the map with the
 * current one lit, and its event in the map page's panel beside it. **Events** is the
 * chronological list with the player's row lit; a click moves the player.
 *
 * All three read one sequence, walked once, so pins, panel and rows describe the same
 * collection.
 *
 * Header controls: **Share on X** (`<ShareOnX>`, a plain click since a collection has no
 * `detected` state), **Report** (open to readers with no account, via `useReportContent`),
 * then the owner's **Edit** and **Drop** (red trash under the two-click confirm, landing on
 * the owner's profile). Drop lives only here; the edit page is Details and Events only.
 */
export default function CollectionPage() {
  // `useSearchParams` opts out of static prerender, so the body sits under Suspense.
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

  // The whole sequence, read once for the three sections: the player says `N of M` and the
  // list picks a step from the same set.
  const {
    items: sequence,
    error: sequenceError,
    loading: sequenceLoading,
  } = useCollectionSequence(id);

  const items = sequence ?? [];
  // Clamped at read time, so a link to a step the collection no longer holds opens on the
  // nearest real one, with no URL write.
  const step = readerStep(searchParams.get("step"), items.length);

  const goToStep = useCallback(
    (next: number) => {
      // `replace`, not `push`: stepping is reading one page, so Back leaves it. `scroll: false`
      // keeps the reader where they picked the step.
      router.replace(collectionStepHref(id, next), { scroll: false });
    },
    [id, router],
  );

  const isOwner = !!user && !!collection && user.id === collection.owner.id;

  // Called before the early returns like every hook here; works signed out, and the panel
  // renders under the header trigger.
  const report = useReportContent("collection", id);

  const drop = useMutation(() => deleteCollection(id), {
    fallback: "Failed to drop the collection",
    // Back to the owner's profile: this page no longer exists.
    onSuccess: () => router.push(`/profile/${collection?.owner.username ?? ""}`),
  });

  // Two clicks, disarming after a few seconds or on any outside click or focus: the same
  // confirm as the edit page's Drop card.
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
            {/* The row says which kind of page this is (collection and event pages share a shape). */}
            <Pill tone="neutral" icon={<CollectionIcon size={11} />}>
              Collection
            </Pill>
          </span>
          <CollectionMetaLine collection={collection} className="text-xs" />
          {/* Tags of the held events, under the meta line like the card. */}
          <CollectionTags collection={collection} />
        </div>
      }
      actions={
        // `flex-wrap` + `justify-end` like the event cluster: stacked right-aligned lines on a
        // phone, not a sideways push.
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <ShareOnX
            path={collectionHref(collection.id)}
            lines={[
              collection.title,
              `by ${collection.owner.username} · ${collectionMetaSegments(collection).join(" · ")}`,
            ]}
          />
          {report.trigger}
          {isOwner && (
            <>
              {/* Navigation: `buttonClasses` on the link, not a button nested in an anchor. */}
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
                // The label says which click this is (an icon button has no text to swap).
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
      {/* Under the header, where the trigger is. */}
      {report.panel}
      {drop.error && (
        <div className={FORM_ERROR_BANNER} role="alert">
          {drop.error}
        </div>
      )}

      <Card as="section">
        <SectionEyebrow title="Description" margin="none" />
        {/* Read back through the proof renderer; a description carries no images, so no graphic gate. */}
        <div className="text-sm text-neutral-300">
          {renderProof(collection.description)}
        </div>
      </Card>

      {/* An empty collection has nothing to step through; the list says so. */}
      {items.length > 0 && (
        <CollectionReader items={items} step={step} onStep={goToStep} />
      )}

      <CollectionItems
        ownerUsername={collection.owner.username}
        items={items}
        isOwner={isOwner}
        loading={sequenceLoading}
        error={sequenceError}
        step={step}
        onStep={goToStep}
      />
    </PageShell>
  );
}
