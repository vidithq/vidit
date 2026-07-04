import Image from "next/image";

import type { Media } from "@/types";
import { displayUrlsFor } from "@/lib/mediaUrls";

/**
 * The detail-surface media block, shared by the geolocation detail page, the
 * map's detail side panel, and the request detail page (which had each grown
 * their own copy, drifting on video posters and img vs next/image).
 *
 * - `page`: 2-up grid at `hero` resolution (~384 CSS px per cell, sharp at 2x
 *   DPI without the original's multi-megabyte payload).
 * - `panel`: stacked tiles at `thumbnail` resolution (max-dim 400). The panel
 *   (~380 CSS px) is the most-fetched surface (every map popup), so it avoids
 *   bleeding bandwidth.
 *
 * Videos load with `#t=0.1` + `preload="metadata"`: the media-fragment URI
 * seeks to t=0.1s on metadata load, painting the first frame as a poster so
 * the tile isn't a black box before play. No media renders one marked empty
 * box (no generated stand-ins).
 */
export function MediaGallery({
  media,
  alt,
  variant = "page",
}: {
  media: Media[];
  /** Alt text for image media (the entity title). */
  alt: string;
  variant?: "page" | "panel";
}) {
  const compact = variant === "panel";
  const itemHeight = compact ? "h-40" : "h-48";

  if (media.length === 0) {
    return (
      <div
        className={`rounded-lg border border-neutral-700 bg-neutral-800 ${itemHeight} flex items-center justify-center`}
      >
        <span className={`${compact ? "text-xs" : "text-sm"} text-neutral-500`}>
          No media available
        </span>
      </div>
    );
  }

  const items = media.map((m) => (
    <div
      key={m.id}
      className={`relative ${itemHeight} rounded-lg overflow-hidden border border-neutral-700${
        compact ? "" : " bg-neutral-900"
      }`}
    >
      {m.media_type === "image" ? (
        <Image
          src={compact ? displayUrlsFor(m).thumbnail : displayUrlsFor(m).hero}
          alt={alt}
          fill
          sizes={compact ? "380px" : "(min-width: 768px) 384px, 100vw"}
          className="object-cover"
        />
      ) : (
        <video
          src={`${m.storage_url}#t=0.1`}
          controls
          preload="metadata"
          className={`w-full ${itemHeight} object-cover`}
        />
      )}
    </div>
  ));

  if (compact) {
    return <div className="space-y-2">{items}</div>;
  }
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{items}</div>;
}
