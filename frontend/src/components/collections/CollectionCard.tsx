import Link from "next/link";
import type { ReactNode } from "react";

import { CollectionCover } from "@/components/collections/CollectionCover";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { TAPPABLE_HOVER } from "@/components/ui/styles";
import {
  collectionHref,
  collectionMetaSegments,
  type Collection,
} from "@/lib/collections";

/**
 * One collection on the profile's grid: the mosaic, the title, the description
 * clamped to two lines, and the meta line the collection's own page prints
 * under its heading.
 *
 * The catalogue click model, the one every row on the site uses: the whole card
 * is a stretched link to the collection, and nothing inside it competes for the
 * click. The row shell is the catalogue card's own (`bg-neutral-900` on a
 * `border-neutral-800` `rounded-md` at `p-3`, accent border on hover), so a
 * collection card and an event card read as the same object in two shapes; the
 * mosaic sits over the text rather than beside it, the `feed` arrangement,
 * since it is the collection's own picture rather than a thumbnail of one
 * item.
 *
 * The card wears no type mark beside its title. The mosaic is what identifies
 * a collection in a grid, and a square glyph in front of the heading only takes
 * width from the two lines the title has to render in. The surfaces that do
 * have to name the type carry `CollectionIcon` instead.
 */
export function CollectionCard({
  collection,
  showOwner = false,
}: {
  collection: Collection;
  /** Lead the meta line with the owner's handle. Off on the profile, where
   *  every card on the page belongs to the analyst the page names; on for a
   *  search result, which stands beside other analysts' collections and where
   *  nothing else says whose shelf this is. */
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
        {/* What the collection says it holds, clamped to two lines: a card is
            one row of a grid, and the collection's own page carries the
            description whole. */}
        <p className="line-clamp-2 text-xs text-neutral-400">
          {collection.description}
        </p>
        <CollectionMetaLine collection={collection} owner={showOwner} />
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
 *
 * `owner` leads with the byline, the catalogue card's own meta grammar
 * (`by @user` first, then the readings), for the one surface where a
 * collection stands beside other analysts': the search results.
 */
export function CollectionMetaLine({
  collection,
  className = "text-[11px]",
  owner = false,
}: {
  collection: Collection;
  /** The host's own type size: `text-[11px]` on a card, `text-xs` on the page
   *  header where it sits under a heading rather than inside a row. */
  className?: string;
  /** Lead with `by @user`. Off wherever the surface already names the owner. */
  owner?: boolean;
}) {
  const segments: { key: string; node: ReactNode }[] = [
    // The card is one stretched link, so the handle is text rather than a
    // second anchor the mouse and the keyboard would disagree about.
    ...(owner
      ? [
          {
            key: "owner",
            node: <AuthorByline author={collection.owner} link={false} />,
          },
        ]
      : []),
    ...collectionMetaSegments(collection).map((segment) => ({
      key: segment,
      node: segment,
    })),
  ];
  return (
    <p
      className={`flex flex-wrap items-center text-neutral-500 ${className}`}
    >
      {segments.map(({ key, node }, i) => (
        <span key={key} className="whitespace-nowrap">
          {i > 0 && (
            <span aria-hidden="true" className="px-1.5 text-neutral-700">
              ·
            </span>
          )}
          {node}
        </span>
      ))}
    </p>
  );
}
