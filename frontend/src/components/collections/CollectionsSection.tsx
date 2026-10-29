"use client";

import Link from "next/link";

import { ActionIcon, buttonClasses } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SeeAllLink } from "@/components/ui/LoadMoreRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { Item } from "@/components/ui/Item";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { useApiResource } from "@/hooks/useApiResource";
import { collectionItem } from "@/lib/items";
import { profileSearchHref } from "@/lib/search";
import {
  CollectionIcon,
  newCollectionHref,
  userCollectionsPath,
  type CollectionPage,
} from "@/lib/collections";

/** How many collections the section previews. */
const PREVIEW_SIZE = 4;

/**
 * The profile's Collections section: the analyst's named sets of their own
 * events, as list `<Item>` rows, between Insights and Recent submissions.
 *
 * The endpoint narrows by viewer: a visitor gets collections holding something a
 * reader may see, the owner all of theirs, empty included. For a visitor an
 * empty list renders nothing (like the coverage map and Insights). For the
 * owner an empty list is a first-run surface with the action that fills it;
 * otherwise **New collection** lives in the profile's actions.
 *
 * `See all` goes to `/search` scoped to this analyst's collections, through
 * the same builder as the submissions list's control. Its `type=collection`
 * mirrors the one filter `search.search_collections` reads; change both.
 *
 * A failed read hides the section, as `ProfileMap` and `ProfileInsights` do.
 */
export function CollectionsSection({
  username,
  isOwn,
}: {
  username: string;
  isOwn: boolean;
}) {
  const { data } = useApiResource<CollectionPage>(
    userCollectionsPath(username, PREVIEW_SIZE),
  );

  // The profile hides this section rather than blocking on it.
  if (!data?.items) return null;

  const collections = data.items;
  if (collections.length === 0 && !isOwn) return null;

  return (
    <Card as="section">
      <div className="space-y-1">
        <SectionEyebrow title="Collections" margin="none" />
        {collections.length > 0 && (
          <p className="text-xs text-neutral-500">
            {`Named groups of ${username}'s events, newest first.`}
          </p>
        )}
      </div>

      {collections.length > 0 ? (
        <>
          <div className="space-y-2">
            {collections.map((collection) => (
              <Item key={collection.id} variant="list" {...collectionItem(collection)} />
            ))}
          </div>
          {data.total > PREVIEW_SIZE && (
            // `type=collection` is the one scope `author` narrows rather than
            // empties, so the expansion serves the set the section previewed.
            <div className="flex justify-center">
              <SeeAllLink href={profileSearchHref(username, {}, "collection")} />
            </div>
          )}
        </>
      ) : (
        // Owner only (the visitor case returned above).
        <EmptyState
          variant="plain"
          icon={CollectionIcon}
          lead="No collections yet."
          cta={
            <Link href={newCollectionHref()} className={buttonClasses("secondary")}>
              <ActionIcon action="newCollection" />
              New collection
            </Link>
          }
        >
          Group your events into a named set: the sites around one place, or a
          series of events over days.
        </EmptyState>
      )}
    </Card>
  );
}
