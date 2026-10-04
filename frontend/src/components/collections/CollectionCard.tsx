import Link from "next/link";

import { CollectionCover } from "@/components/collections/CollectionCover";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { Pill } from "@/components/ui/Pill";
import { TAPPABLE_HOVER } from "@/components/ui/styles";
import {
  collectionHref,
  collectionMetaSegments,
  type Collection,
} from "@/lib/collections";

/**
 * One collection on the profile's grid: the mosaic, the title, the description's
 * plain-text projection clamped to two lines, the meta line, and the tags its
 * items carry.
 *
 * The whole card is a stretched link. The shell matches the catalogue card's, with
 * the mosaic over the text (the `feed` arrangement). No type mark beside the
 * title: the mosaic identifies a collection, and a glyph would take width from
 * the two title lines.
 */
export function CollectionCard({
  collection,
  showOwner = false,
}: {
  collection: Collection;
  /** Lead the meta line with the owner's handle. On for a search result, off on
   *  the profile where the page names the analyst. */
  showOwner?: boolean;
}) {
  return (
    <div
      className={`group relative flex flex-col gap-3 rounded-md border border-neutral-800 bg-neutral-900 p-3 ${TAPPABLE_HOVER}`}
    >
      <Link
        href={collectionHref(collection.id)}
        aria-label={collection.title}
        className="absolute inset-0 z-10 rounded-[inherit]"
      />
      <CollectionCover cover={collection.cover} />
      <div className="min-w-0 space-y-1.5">
        <h3 className="line-clamp-2 text-sm font-medium text-neutral-100 group-hover:text-orange-400">
          {collection.title}
        </h3>
        {/* The plain-text projection the server stores beside the document. */}
        <p className="line-clamp-2 text-xs text-neutral-400">
          {collection.description_text}
        </p>
        <CollectionMetaLine collection={collection} owner={showOwner} />
        <CollectionTags collection={collection} />
      </div>
    </div>
  );
}

/**
 * The tags of the events the collection holds, in the slot and `Pill` size
 * `EntityCard` uses. Derived server-side, so the pills are text, not links (the
 * card is one stretched link). Shared by the card and the page header so they
 * cannot print different tags. Renders nothing without tags.
 */
export function CollectionTags({ collection }: { collection: Collection }) {
  if (collection.tags.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
      {collection.tags.map((tag) => (
        <Pill key={tag.id} tone="neutral">
          {tag.name}
        </Pill>
      ))}
    </div>
  );
}

/**
 * The meta line under a collection's name: how much it holds, then the span its
 * items cover. Shared by the card and the page header. Each segment stays on one
 * line, so the row wraps between segments at 375px.
 *
 * `owner` leads with the byline (`by @user`), for search results.
 */
export function CollectionMetaLine({
  collection,
  className = "text-[11px]",
  owner = false,
}: {
  collection: Collection;
  /** The host's type size (`text-xs` on the page header). */
  className?: string;
  owner?: boolean;
}) {
  return (
    <p className={`flex flex-wrap items-center text-neutral-500 ${className}`}>
      {owner && (
        // The card is one stretched link, so the handle is text, not a second anchor.
        <span className="whitespace-nowrap">
          <AuthorByline author={collection.owner} link={false} />
        </span>
      )}
      {collectionMetaSegments(collection).map((segment, i) => (
        <span key={segment} className="whitespace-nowrap">
          {(owner || i > 0) && SEPARATOR}
          {segment}
        </span>
      ))}
    </p>
  );
}

/** Decorative, so a screen reader does not read the punctuation. */
const SEPARATOR = (
  <span aria-hidden="true" className="px-1.5 text-neutral-700">
    ·
  </span>
);
