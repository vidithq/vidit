"use client";

import { Suspense, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Pencil, Trash2 } from "lucide-react";

import { CollectionCoverage } from "@/components/collections/CollectionCoverage";
import { CollectionItems } from "@/components/collections/CollectionItems";
import { CollectionDetails, CollectionShell } from "@/components/collections/CollectionShell";
import { useReportContent } from "@/components/report/useReportContent";
import ShareOnX from "@/components/share/ShareOnX";
import { Tooltip } from "@/components/ui/Tooltip";
import { Button, buttonClasses, DANGER_CONFIRM } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PageError, PageLoading } from "@/components/ui/PageShell";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { useAuth } from "@/contexts/AuthContext";
import { useApiResource } from "@/hooks/useApiResource";
import { useCollectionSequence } from "@/hooks/useCollectionSequence";
import { useConfirmAction } from "@/hooks/useConfirmAction";
import { useMutation } from "@/hooks/useMutation";
import {
  collectionEditHref,
  collectionHref,
  collectionMetaSegments,
  collectionStepHref,
  deleteCollection,
  readerStep,
  type Collection,
} from "@/lib/collections";
import { renderProof } from "@/lib/proof";
import { profileHref } from "@/lib/routes";
import { ErrorNotice } from "@/components/ui/ErrorNotice";

/**
 * One collection page, on `CollectionShell`: the title, the owner byline with a `Collection` pill,
 * and the actions pinned top right. The main column holds **Description**, the owner's text at
 * reading size through `renderProof` (the card clamps its plain-text projection instead), then
 * **Events**, the chronological list with the current row lit; a click moves the step. The side
 * column, pinned while the list scrolls, holds **Coverage**, the items on the map with the
 * current one lit and its row of moves, then **Details**.
 *
 * Both sections read one sequence, walked once, so pins and rows describe the same collection.
 *
 * Actions: **Share on X** (`<ShareOnX>`, a plain click since a collection has no `detected`
 * state), **Report** (open to readers with no account, via `useReportContent`), then the owner's
 * **Edit** and **Drop** (red trash under the two-click confirm, landing on the owner's profile).
 * Drop lives only here.
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

  const { data: collection, error, refetch } = useApiResource<Collection>(
    id ? `/collections/${id}` : null,
  );

  // The whole sequence, read once for both sections: Coverage says `N of M` and the list picks a
  // step from the same set.
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
    onSuccess: () => router.push(profileHref(collection?.owner.username ?? "")),
  });

  // Two clicks, disarming after a few seconds or on any outside click or focus.
  const {
    armed: dropArmed,
    trigger: triggerDrop,
    controlRef: dropButtonRef,
  } = useConfirmAction(() => void drop.run(), {
    timeoutMs: 4000,
    dismissOnOutside: true,
  });

  const dropLabel = dropArmed ? "Confirm dropping this collection" : "Drop this collection";

  if (error) return <PageError error={error} onRetry={refetch} backHref="/map" />;
  if (!collection) return <PageLoading />;

  return (
    <CollectionShell
      title={collection.title}
      owner={collection.owner}
      actions={
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
              <Tooltip label="Edit this collection">
                <Link
                  href={collectionEditHref(collection.id)}
                  className={buttonClasses("ghost", { icon: true })}
                  aria-label="Edit this collection"
                >
                  <Pencil size={14} />
                </Link>
              </Tooltip>
              <Button
                ref={dropButtonRef}
                icon
                variant="danger"
                disabled={drop.loading}
                onClick={triggerDrop}
                className={dropArmed ? DANGER_CONFIRM : ""}
                // The label says which click this is (an icon button has no text to swap).
                aria-label={dropLabel}
                title={dropLabel}
              >
                <Trash2 size={14} />
              </Button>
            </>
          )}
        </div>
      }
      panels={
        <>
          {/* Under the header, where the trigger is. */}
          {report.panel}
          {drop.error && (
            <ErrorNotice error={drop.error} />
          )}
        </>
      }
      main={
        <>
          <section>
            <SectionEyebrow title="Description" />
            <Card dense>
              {/* Read back through the proof renderer; a description carries no images, so no graphic gate. */}
              <div className="text-sm text-neutral-300">{renderProof(collection.description)}</div>
            </Card>
          </section>
          <CollectionItems
            ownerUsername={collection.owner.username}
            items={items}
            isOwner={isOwner}
            loading={sequenceLoading}
            error={sequenceError}
            step={step}
            onStep={goToStep}
          />
        </>
      }
      side={
        <>
          <CollectionCoverage items={items} step={step} onStep={goToStep} />
          <CollectionDetails
            count={collection.event_count}
            first={collection.first_date}
            last={collection.last_date}
            tags={collection.tags}
            created={collection.created_at}
          />
        </>
      }
    />
  );
}
