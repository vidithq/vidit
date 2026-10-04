/**
 * The one muted line a media box says when it has nothing to show: an empty media
 * set (`MediaGallery`) or a clip the browser refused (`VideoPlayer`). Fills its
 * box, so it centres as the tile or inside one. `compact` matches the panel's
 * tighter type.
 *
 * Its own module: the gallery renders the player, so a shared notice in either
 * would close an import cycle.
 */
export function TileNotice({
  compact = false,
  children,
}: {
  compact?: boolean;
  children: string;
}) {
  return (
    <div className="h-full flex items-center justify-center">
      <span className={`${compact ? "text-xs" : "text-sm"} text-neutral-500`}>
        {children}
      </span>
    </div>
  );
}
