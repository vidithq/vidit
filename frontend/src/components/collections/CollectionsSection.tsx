"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Layers, Plus } from "lucide-react";

import { CollectionCard } from "@/components/collections/CollectionCard";
import { CollectionTitleForm } from "@/components/collections/CollectionTitleForm";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { useApiResource } from "@/hooks/useApiResource";
import { useMutation } from "@/hooks/useMutation";
import {
  collectionHref,
  createCollection,
  userCollectionsPath,
  type CollectionPage,
} from "@/lib/collections";

/** How many cards the grid holds before the reader asks for the rest. Six is
 *  three rows of the two-column grid, enough to read as a shelf without
 *  pushing the submissions list below it off the page. */
const GRID_PAGE = 6;

/** The row cap every list endpoint shares, which is what *Show all* raises the
 *  page to: one more read serves every collection an analyst can have on
 *  screen at once. */
const ALL = 100;

/**
 * The profile's Collections section: the analyst's named sets of their own
 * events, as a grid of cover cards.
 *
 * It sits between Insights and Recent submissions, which is where the page
 * moves from readings of the whole body of work to the work itself: a
 * collection is the analyst's own grouping of that work, so it reads after the
 * summary that describes all of it and before the list that just grows.
 *
 * The endpoint narrows itself by viewer: a visitor gets the collections that
 * hold something a reader may see, and the owner gets all of theirs, empty ones
 * included. So an empty list means two different things and the section says
 * each of them once. For a visitor there is nothing to show and the section
 * renders nothing at all, the way the coverage map and the Insights card drop
 * out for an analyst with no events. For the owner it is a first-run surface,
 * so it keeps the heading and offers the action that fills it.
 *
 * A failed read hides the section rather than blocking the profile, matching
 * `ProfileMap` and `ProfileInsights`.
 */
export function CollectionsSection({
  username,
  isOwn,
}: {
  username: string;
  isOwn: boolean;
}) {
  const router = useRouter();
  const [showAll, setShowAll] = useState(false);
  const [creating, setCreating] = useState(false);
  const { data } = useApiResource<CollectionPage>(
    userCollectionsPath(username, showAll ? ALL : GRID_PAGE),
  );

  // A collection opens on its own page, so the create hands over rather than
  // re-reading the grid: the analyst's next act is putting events on it.
  const create = useMutation(createCollection, {
    fallback: "Failed to create the collection",
    onSuccess: (collection) => {
      setCreating(false);
      router.push(collectionHref(collection.id));
    },
  });

  // Nothing until the read lands and carries rows: the section is one of
  // three blocks the profile hides rather than blocks on, so a read that has
  // not answered and a body that is not a page of collections both leave the
  // page exactly as it was.
  if (!data?.items) return null;

  const collections = data.items;
  if (collections.length === 0 && !isOwn) return null;

  const newCollection = (
    <Button variant="secondary" onClick={() => setCreating(true)}>
      <Plus size={14} strokeWidth={1.8} />
      New collection
    </Button>
  );

  return (
    <Card as="section">
      {/* The heading block asks for a basis and the action takes its own line
          below it once the two cannot share a row, the same wrapping rule the
          submissions list and `PageShell`'s header use. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="basis-56 grow min-w-0 space-y-1">
          <SectionEyebrow title="Collections" margin="none" />
          <p className="text-xs text-neutral-500">
            {collections.length > 0
              ? `Named groups of ${username}'s events, newest first.`
              : "No collections yet."}
          </p>
        </div>
        {isOwn && !creating && collections.length > 0 && (
          <div className="shrink-0">{newCollection}</div>
        )}
      </div>

      {isOwn && creating && (
        <CollectionTitleForm
          submitLabel="Create collection"
          hint="The only free-text field. Items order themselves by event date, so a collection carries no description."
          busy={create.loading}
          error={create.error}
          onSubmit={(title) => void create.run(title)}
          onCancel={() => setCreating(false)}
        />
      )}

      {collections.length > 0 ? (
        <>
          {/* One column on a phone: a 16:9 cover over a two-line title in half
              of a 375px column leaves the title nothing to render in. */}
          <div className="grid gap-2 sm:grid-cols-2">
            {collections.map((collection) => (
              <CollectionCard key={collection.id} collection={collection} />
            ))}
          </div>
          {data.total > collections.length && (
            <div className="flex justify-center">
              <Button variant="ghost" onClick={() => setShowAll(true)}>
                Show all {data.total}
              </Button>
            </div>
          )}
        </>
      ) : (
        // Owner only: the visitor case returned above. A first-run surface
        // says what a collection is for, since the word alone does not, and
        // hands over the one action that fills it.
        !creating && (
          <EmptyState
            variant="plain"
            icon={Layers}
            lead="No collections yet."
            cta={newCollection}
          >
            Group your events into a named set: the sites around one place, or a
            series of events over days.
          </EmptyState>
        )
      )}
    </Card>
  );
}
