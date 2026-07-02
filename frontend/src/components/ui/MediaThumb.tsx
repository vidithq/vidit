import { cn } from "@/lib/cn";
import { displayUrlsFor } from "@/lib/mediaUrls";
import type { Media } from "@/types";

// The one fixed-ratio media slot on cards: the real media when there is one
// (image thumbnail, or muted video first-frame via a `#t=0.1` media fragment +
// `preload="metadata"` so it paints as a poster), else a marked "no media"
// box. No generated stand-ins: a card without media says so.
export function MediaThumb({
  media,
  className,
}: {
  media?: Media;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative w-28 aspect-video rounded-md overflow-hidden bg-neutral-800 shrink-0",
        className,
      )}
    >
      {media ? (
        media.media_type === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={displayUrlsFor(media).thumbnail}
            alt=""
            className="w-full h-full object-cover"
          />
        ) : (
          <video
            src={`${media.storage_url}#t=0.1`}
            className="w-full h-full object-cover"
            preload="metadata"
            muted
          />
        )
      ) : (
        <div className="w-full h-full flex items-center justify-center text-neutral-600 text-xs">
          no media
        </div>
      )}
    </div>
  );
}
