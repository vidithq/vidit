"use client";

import { useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { Layers } from "lucide-react";

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
 * event: the title, the owner's byline under it with a `Collection` pill saying
 * what kind of page this is, the meta line the profile card prints beside the
 * mosaic, and the description under it, at reading size and whole, where the
 * card clamps it to two lines. The mosaic itself is the profile card's picture
 * and nothing
 * else: the page opens on the name of the collection rather than on a band the
 * width of the page.
 *
 * Then the work, widest first, the profile's own order: the items on a map, and
 * the chronological list under it. Both read one set, the items themselves, so
 * the pins and the rows can never describe different collections.
 *
 * The page is public. The owner's two verbs (the title and dropping the
 * collection) ride the header cluster with their panels under it, which is
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
          {/* What the owner says the collection holds, at reading size under
              the two lines that identify it. `whitespace-pre-line` keeps the
              paragraph breaks they typed; the text is plain, so nothing else
              of what they wrote is rendered. */}
          <p className="whitespace-pre-line text-sm text-neutral-300">
            {collection.description}
          </p>
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
          // The header's count and date range both move with the set, and the
          // walk so far is a page of a list that just changed.
          refetch();
          list.reload();
        }}
      />
    </PageShell>
  );
}
