import { MediaThumb } from "@/components/ui/EntityCard";
import { cn } from "@/lib/cn";
import type { CollectionCoverTile } from "@/lib/collections";

/**
 * A collection's mosaic, in the profile card's 16:9 slot. Nothing is uploaded:
 * the tiles are the media of the first few items, picked server side in reading
 * order (`api.md`, `GET /collections/{id}`), so the card shows what the
 * collection holds.
 *
 * Each tile is `MediaThumb`, so a clip plays as a clip, and an empty collection
 * falls back to the site's one "no media" placeholder.
 *
 * Arrangement by tile count: one fills the slot, two split it, three put the
 * earliest tall on the left, four fill a 2x2. The 2px gaps read as one picture
 * divided.
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
            // A proof-image tile carries `proof`: the slot reads the original,
            // since the proof upload writes no `_hero` / `_thumb` sibling.
            role: tile.role,
          }}
          // A lone tile spans the column (wide derivative); a shared tile is at
          // most half of it (the 400 px derivative).
          size={cover.length === 1 ? "hero" : "thumbnail"}
          className={cn(
            // A grid cell, not a fixed box; the mosaic owns the rounding.
            "aspect-auto h-full w-full min-w-0 self-stretch rounded-none",
            cover.length === 3 && index === 0 && "row-span-2",
          )}
        />
      ))}
    </div>
  );
}
