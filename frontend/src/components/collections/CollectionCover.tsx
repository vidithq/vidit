import { MediaThumb } from "@/components/ui/EntityCard";
import type { CollectionCoverRead } from "@/lib/collections";

/**
 * A collection's cover, in the two shapes the product shows it: the card's
 * 16:9 slot on the profile grid, and the band over the collection page's own
 * header.
 *
 * It is the catalogue card's media slot (`MediaThumb`), so a cover and an event
 * thumbnail are the same box and a collection with nothing to show falls back
 * to the one "no media" placeholder the site already draws rather than to a
 * second stand-in of its own. The picture is decorative: the title names the
 * collection right beside it, and on a card the stretched link is already
 * labelled with that title.
 *
 * The two covers reach the slot differently, which is what `is_uploaded` on the
 * read is for. A default cover is one item's own Media row, so it goes through
 * `media` and takes that row's kind and its display derivative: a video default
 * plays as a clip rather than sitting in an `<img>` as an empty band. An
 * uploaded cover is a single already-resized JPEG with no derivative beside it,
 * so it goes through `src` and is rendered as stored.
 *
 * The band takes the embedded surface treatment the page's map below it takes
 * (a `rounded-lg` box on a `neutral-700` border), at a band height rather than
 * a hero: shorter on a phone, where the header plus a full-height cover would
 * push the title itself under the fold.
 */
export function CollectionCover({
  cover,
  variant = "card",
}: {
  cover: CollectionCoverRead | null;
  /** `card`: the profile grid's 16:9 slot. `band`: the page header's strip. */
  variant?: "card" | "band";
}) {
  const uploaded = cover?.is_uploaded ?? false;
  return (
    <MediaThumb
      src={cover && uploaded ? cover.url : undefined}
      media={
        cover && !uploaded
          ? { storage_url: cover.url, media_type: cover.media_type }
          : undefined
      }
      // Both shapes span their column, so the cover reads the wide derivative
      // rather than the 400 px one a card row's slot shows.
      size="hero"
      className={
        variant === "band"
          ? "w-full aspect-auto h-30 sm:h-40 rounded-lg border border-neutral-700"
          : "w-full"
      }
    />
  );
}
