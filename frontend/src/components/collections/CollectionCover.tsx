import { MediaThumb } from "@/components/ui/EntityCard";
import type { CollectionCoverRead } from "@/lib/collections";

/**
 * A collection's cover: the picture the profile grid's card wears, in that
 * card's 16:9 slot. The collection's own page carries no cover, so this is the
 * one place a reader meets it and the owner's cover panel is the one place it
 * is set.
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
 */
export function CollectionCover({ cover }: { cover: CollectionCoverRead | null }) {
  const uploaded = cover?.is_uploaded ?? false;
  return (
    <MediaThumb
      src={cover && uploaded ? cover.url : undefined}
      media={
        cover && !uploaded
          ? { storage_url: cover.url, media_type: cover.media_type }
          : undefined
      }
      // The slot spans its column, so the cover reads the wide derivative
      // rather than the 400 px one a card row's slot shows.
      size="hero"
      className="w-full"
    />
  );
}
