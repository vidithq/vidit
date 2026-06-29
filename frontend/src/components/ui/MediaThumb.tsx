import { displayUrlsFor } from "@/lib/mediaUrls";
import type { Media } from "@/types";

// Fixed-ratio media thumbnail (image thumbnail or muted video first-frame, with
// a "no media" fallback), shared by the bounty cards on the list and search
// pages, which had byte-identical copies. The video uses a `#t=0.1` media
// fragment + `preload="metadata"` so the first frame paints as a poster.
export function MediaThumb({
  media,
  className = "relative w-28 aspect-video rounded-md overflow-hidden bg-neutral-800 shrink-0",
}: {
  media?: Media;
  className?: string;
}) {
  return (
    <div className={className}>
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
