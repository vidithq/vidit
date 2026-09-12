"use client";

import { useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { Layers } from "lucide-react";

import { CollectionCover } from "@/components/collections/CollectionCover";
import { CollectionItems } from "@/components/collections/CollectionItems";
import { CollectionMetaLine } from "@/components/collections/CollectionCard";
import { useCollectionActions } from "@/components/collections/useCollectionActions";
import { CoverageMap } from "@/components/map/CoverageMap";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { PageError, PageLoading, PageShell } from "@/components/ui/PageShell";
import { Pill } from "@/components/ui/Pill";
import { useAuth } from "@/contexts/AuthContext";
import { useApiResource } from "@/hooks/useApiResource";
import { useCursorList } from "@/hooks/useCursorList";
import {
  collectionEventsPath,
  collectionPoints,
  type Collection,
} from "@/lib/collections";
import type { EventListItem } from "@/types";

/**
 * One collection: what it is, where its items are, and what they are.
 *
 * The header is the collection itself, the grammar the event page uses for an
 * event: the cover band over the title, the owner's byline under it with a
 * `Collection` pill saying what kind of page this is, and the meta line the
 * profile card prints beside the same cover. The band renders only when the
 * collection has a picture to show, so a collection with no cover opens on its
 * title rather than on a placeholder band the width of the page.
 *
 * Then the work, widest first, the profile's own order: the items on a map, and
 * the chronological list under it. Both read one set, the items themselves, so
 * the pins and the rows can never describe different collections.
 *
 * The page is public. The owner's three verbs (the title, the cover, dropping
 * the collection) ride the header cluster with their panels under it, which is
 * where every other surface puts the controls that act on the thing the page is
 * about.
 */
export default function CollectionPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const id = typeof params.id === "string" ? params.id : "";

  const {
    data: collection,
    error,
    refetch,
  } = useApiResource<Collection>(id ? `/collections/${id}` : null);

  // Memoized so the cursor walk keys on the path rather than on a fresh
  // closure each render (see `useCursorList`).
  const buildPath = useCallback(
    (cursor: string | null) => collectionEventsPath(id, cursor),
    [id],
  );
  const list = useCursorList<EventListItem>(buildPath);

  const isOwner = !!user && !!collection && user.id === collection.owner.id;

  // Called before the early returns, as every hook here must be.
  const { actions, panels } = useCollectionActions({
    collection,
    isOwner,
    onChanged: refetch,
    onDeleted: () =>
      router.push(`/profile/${collection?.owner.username ?? ""}`),
  });

  const points = useMemo(() => collectionPoints(list.items), [list.items]);

  if (error) return <PageError message={error} backHref="/map" />;
  if (!collection) return <PageLoading />;

  return (
    <PageShell
      back
      banner={
        collection.cover_url && (
          <CollectionCover coverUrl={collection.cover_url} variant="band" />
        )
      }
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

      <CoverageMap
        points={points}
        caption={`${points.length} ${points.length === 1 ? "event" : "events"} on the map`}
      />

      <CollectionItems
        collectionId={collection.id}
        items={list.items}
        isOwner={isOwner}
        loading={list.loading}
        error={list.error}
        hasMore={list.hasMore}
        loadingMore={list.loadingMore}
        onLoadMore={list.loadMore}
        onRemoved={() => {
          // The header's count, date range and default cover all move with the
          // set, and the walk so far is a page of a list that just changed.
          refetch();
          list.reload();
        }}
      />
    </PageShell>
  );
}
