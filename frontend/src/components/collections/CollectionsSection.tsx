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

/** Two rows of the two-column grid. */
const GRID_SIZE = 4;

/**
 * The profile's Collections section: the analyst's named sets of their own
 * events, as a grid of mosaic cards, between Insights and Recent submissions.
 *
 * The endpoint narrows by viewer: a visitor gets collections holding something a
 * reader may see, the owner all of theirs, empty included. For a visitor an
 * empty list renders nothing (like the coverage map and Insights). For the
 * owner it is a first-run surface with the action that fills it.
 *
 * `Show more` goes to `/search` scoped to this analyst's collections, through
 * the same builder as the submissions list's control. Its `type=collection`
 * mirrors the one filter `search.search_collections` reads; change both.
 *
 * Both of the owner's entry points link to `/collections/new`. A failed read
 * hides the section, as `ProfileMap` and `ProfileInsights` do.
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

  // The profile hides this section rather than blocking on it.
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
      {/* The action wraps below the heading once they cannot share a row. */}
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
          {/* One column on a phone: half of 375px leaves the title no room. */}
          <div className="grid gap-2 sm:grid-cols-2">
            {collections.map((collection) => (
              <CollectionCard key={collection.id} collection={collection} />
            ))}
          </div>
          {data.total > GRID_SIZE && (
            // `type=collection` is the one scope `author` narrows rather than
            // empties, so the expansion serves the set the grid previewed.
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
        // Owner only (the visitor case returned above).
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
