import Link from "next/link";
import { Layers } from "lucide-react";

import { CollectionCover } from "@/components/collections/CollectionCover";
import { ACCENT_SURFACE, TAPPABLE_HOVER } from "@/components/ui/styles";
import {
  collectionHref,
  collectionMetaSegments,
  type Collection,
} from "@/lib/collections";

/**
 * One collection on the profile's grid: the cover, the title, and the meta line
 * the collection's own page prints under its heading.
 *
 * The catalogue click model, the one every row on the site uses: the whole card
 * is a stretched link to the collection, and nothing inside it competes for the
 * click. The row shell is the catalogue card's own (`bg-neutral-900` on a
 * `border-neutral-800` `rounded-md` at `p-3`, accent border on hover), so a
 * collection card and an event card read as the same object in two shapes; the
 * cover sits over the text rather than beside it, the `feed` arrangement, since
 * a cover is the collection's picture rather than a thumbnail of one item.
 */
export function CollectionCard({ collection }: { collection: Collection }) {
  return (
    <div
      className={`group relative flex flex-col gap-3 rounded-md border border-neutral-800 bg-neutral-900 p-3 ${TAPPABLE_HOVER}`}
    >
      <Link
        href={collectionHref(collection.id)}
        aria-label={collection.title}
        className="absolute inset-0 z-10 rounded-[inherit]"
      />
      <CollectionCover coverUrl={collection.cover_url} />
      <div className="flex gap-3">
        {/* The mark says what kind of thing the card is, which a cover cannot:
            an uploaded cover is an arbitrary picture, and the fallback is one
            item's own media. Accent because the whole card is the click, so
            the paint is the active-row surface rather than a decorative
            icon. */}
        <span
          aria-hidden="true"
          className={`flex size-8 shrink-0 items-center justify-center rounded-md ${ACCENT_SURFACE}`}
        >
          <Layers size={14} />
        </span>
        <div className="min-w-0 flex-1 space-y-1.5">
          <h3 className="line-clamp-2 text-sm font-medium text-neutral-100 group-hover:text-orange-400">
            {collection.title}
          </h3>
          <CollectionMetaLine collection={collection} />
        </div>
      </div>
    </div>
  );
}

/**
 * The meta line under a collection's name: how much it holds, then the span its
 * items cover. Shared by the card and the collection page's own header, so the
 * two cannot count or date one collection differently.
 *
 * Each segment holds together on its own line, the profile metadata line's
 * rule, so the row wraps between segments rather than inside a date at 375px.
 */
export function CollectionMetaLine({
  collection,
  className = "text-[11px]",
}: {
  collection: Collection;
  /** The host's own type size: `text-[11px]` on a card, `text-xs` on the page
   *  header where it sits under a heading rather than inside a row. */
  className?: string;
}) {
  return (
    <p
      className={`flex flex-wrap items-center text-neutral-500 ${className}`}
    >
      {collectionMetaSegments(collection).map((segment, i) => (
        <span key={segment} className="whitespace-nowrap">
          {i > 0 && (
            <span aria-hidden="true" className="px-1.5 text-neutral-700">
              ·
            </span>
          )}
          {segment}
        </span>
      ))}
    </p>
  );
}
