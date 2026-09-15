"use client";

import Link from "next/link";
import { Plus } from "lucide-react";

import { CollectionCard } from "@/components/collections/CollectionCard";
import { buttonClasses } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { useApiResource } from "@/hooks/useApiResource";
import { profileSearchHref } from "@/lib/search";
import {
  CollectionIcon,
  newCollectionHref,
  userCollectionsPath,
  type CollectionPage,
} from "@/lib/collections";

/** How many cards the grid holds. Four is two rows of the two-column grid,
 *  enough to read as a shelf without pushing the submissions list below it off
 *  the page. */
const GRID_SIZE = 4;

/**
 * The profile's Collections section: the analyst's named sets of their own
 * events, as a grid of mosaic cards.
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
 * The grid holds four cards and `Show more` hands the reader to `/search`
 * scoped to this analyst's collections, the submissions list's control in the
 * same shape and through the same builder. The section previews the shelf and
 * search is where the whole of it is walked, so the profile stays one screen of
 * readings rather than a surface that grows without end.
 *
 * Both of the owner's entry points, the action beside the heading and the one
 * in the first-run state, are the same link to `/collections/new`: opening a
 * collection is a page of its own, so the profile hands over rather than
 * growing a form inside a section that is otherwise a reading surface.
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
  const { data } = useApiResource<CollectionPage>(
    userCollectionsPath(username, GRID_SIZE),
  );

  // Nothing until the read lands and carries rows: the section is one of
  // three blocks the profile hides rather than blocks on, so a read that has
  // not answered and a body that is not a page of collections both leave the
  // page exactly as it was.
  if (!data?.items) return null;

  const collections = data.items;
  if (collections.length === 0 && !isOwn) return null;

  const newCollection = (
    <Link href={newCollectionHref()} className={buttonClasses("secondary")}>
      <Plus size={14} strokeWidth={1.8} />
      New collection
    </Link>
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
        {isOwn && collections.length > 0 && (
          <div className="shrink-0">{newCollection}</div>
        )}
      </div>

      {collections.length > 0 ? (
        <>
          {/* One column on a phone: a 16:9 mosaic over a two-line title in half
              of a 375px column leaves the title nothing to render in. */}
          <div className="grid gap-2 sm:grid-cols-2">
            {collections.map((collection) => (
              <CollectionCard key={collection.id} collection={collection} />
            ))}
          </div>
          {data.total > GRID_SIZE && (
            // The submissions list's `Show more` in the same shape and through
            // the same builder: `type=collection`, which is the one scope the
            // `author` filter narrows rather than empties, so the expansion
            // serves the set the grid previewed.
            <div className="flex justify-center">
              <Link
                href={profileSearchHref(username, {}, "collection")}
                className={buttonClasses("secondary", {
                  className: "whitespace-nowrap",
                })}
              >
                Show more
              </Link>
            </div>
          )}
        </>
      ) : (
        // Owner only: the visitor case returned above. A first-run surface
        // says what a collection is for, since the word alone does not, and
        // hands over the one action that fills it.
        <EmptyState
          variant="plain"
          icon={CollectionIcon}
          lead="No collections yet."
          cta={newCollection}
        >
          Group your events into a named set: the sites around one place, or a
          series of events over days.
        </EmptyState>
      )}
    </Card>
  );
}
