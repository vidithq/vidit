import { MediaThumb } from "@/components/ui/EntityCard";
import { cn } from "@/lib/cn";
import type { CollectionCoverTile } from "@/lib/collections";

/**
 * A collection's mosaic: the picture the profile grid's card wears, in that
 * card's 16:9 slot. The collection's own page carries none, so this is the one
 * place a reader meets it.
 *
 * Nothing here is uploaded or stored. The tiles are the media of the first few
 * items the collection holds, picked server side and handed over in reading
 * order (`api.md` → `GET /collections/{id}`), the way a playlist icon is made
 * of the covers of what is on it: what the card shows is what the collection
 * holds, and it changes when the shelf does.
 *
 * Each tile is the catalogue card's media slot (`MediaThumb`), so a mosaic tile
 * and an event thumbnail are the same box and a clip plays as a clip rather
 * than sitting in an `<img>` as an empty band. A collection with nothing to
 * show falls back to the one "no media" placeholder the site already draws
 * rather than to a second stand-in of its own.
 *
 * The arrangement is the tile count: one fills the slot, two split it down the
 * middle, three put the earliest item tall on the left with the next two
 * stacked beside it, and four fill a 2x2. The gaps are 2px of the neutral the
 * card's own border carries, so the tiles read as one picture divided rather
 * than as four cards.
 */
export function CollectionCover({ cover }: { cover: CollectionCoverTile[] }) {
  if (cover.length === 0) {
    return <MediaThumb className="w-full" size="hero" />;
  }
  return (
    <div
      className={cn(
        "grid aspect-video w-full gap-[2px] overflow-hidden rounded-md bg-neutral-800",
        cover.length === 1 ? "grid-cols-1" : "grid-cols-2",
        cover.length > 2 && "grid-rows-2",
      )}
    >
      {cover.map((tile, index) => (
        <MediaThumb
          key={`${tile.url}-${index}`}
          media={{
            storage_url: tile.url,
            media_type: tile.media_type,
            // A tile taken off an item's proof image carries `proof`, and the
            // slot reads the original for it: the proof upload writes no
            // `_hero` / `_thumb` sibling to ask for.
            role: tile.role,
          }}
          // A lone tile spans the whole card column and reads the wide
          // derivative; a tile sharing the slot is at most half of it, which is
          // what the card row's own 400 px derivative is sized for.
          size={cover.length === 1 ? "hero" : "thumbnail"}
          className={cn(
            // The slot is a grid cell here rather than a fixed box: it takes
            // the cell whole, and the rounding belongs to the mosaic around it.
            "aspect-auto h-full w-full min-w-0 self-stretch rounded-none",
            // Three tiles: the earliest item takes the left column entire.
            cover.length === 3 && index === 0 && "row-span-2",
          )}
        />
      ))}
    </div>
  );
}
