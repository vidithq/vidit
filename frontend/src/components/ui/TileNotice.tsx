/**
 * The one muted line a media box says when it has nothing to show: an empty
 * media set (`MediaGallery`) or a clip the browser refused (`VideoPlayer`).
 *
 * Fills its box, so it centers whether it *is* the tile or sits inside one.
 * `compact` matches the panel variant's tighter type scale.
 *
 * Its own module rather than a `MediaGallery` export: the gallery renders the
 * player, so a shared notice living in either one would close an import cycle.
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
