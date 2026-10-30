import { Dot } from "@/components/ui/Dot";

/** What a media box says when its file does not load: the player and the form's file slot. */
export const FILE_UNAVAILABLE = "File unavailable";

/**
 * The one muted line a media box says when it has nothing to show: an empty media
 * set (`MediaGallery`), a clip the browser refused (`VideoPlayer`), or a file still on
 * its way (`GifSplit`), which `busy` leads with the pulsing `<Dot>`. Fills its box, so
 * it centres as the tile or inside one. `compact` matches the panel's tighter type.
 *
 * Its own module: the gallery renders the player, so a shared notice in either
 * would close an import cycle.
 */
export function TileNotice({
  compact = false,
  busy = false,
  children,
}: {
  compact?: boolean;
  busy?: boolean;
  children: string;
}) {
  return (
    <div className="h-full flex items-center justify-center px-3 text-center">
      <span
        className={`${compact ? "text-xs" : "text-sm"} inline-flex items-center gap-2 text-neutral-500`}
      >
        {busy && <Dot className="shrink-0 animate-pulse" />}
        {children}
      </span>
    </div>
  );
}
