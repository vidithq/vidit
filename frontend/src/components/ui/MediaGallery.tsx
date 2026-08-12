"use client";

import { useState } from "react";
import Image from "next/image";

import type { Media } from "@/types";
import { displayUrlsFor } from "@/lib/mediaUrls";
import { MediaDownloadButton } from "@/components/ui/MediaDownloadButton";
import { MediaLightbox } from "@/components/ui/MediaLightbox";
import { TileNotice } from "@/components/ui/TileNotice";
import { VideoPlayer } from "@/components/ui/VideoPlayer";
import { HOVER_REVEAL } from "@/components/ui/styles";

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
 * **Video tiles** are [`VideoPlayer`](./VideoPlayer.tsx), whose hover-revealed
 * bar carries play, scrub, download and one expand control (`onExpand`) that
 * opens the same in-page lightbox as an image tile, so the "see it bigger"
 * gesture is identical across media types. The actual full screen lives on the
 * lightbox's player only, so a single big-view icon shows per context. A clip
 * the browser can't decode swaps to a text notice instead of a silent black
 * box.
 *
 * **Image tiles** keep `object-cover`: on a tile the crop is deliberate, and the
 * whole tile opens `MediaLightbox` at `hero` resolution to see it uncropped.
 * Their download floats in the corner, revealed on hover so it isn't permanent
 * furniture over the picture (`HOVER_REVEAL` keeps it visible on touch, where
 * there is no hover to reveal it with).
 *
 * No media renders one marked empty box (no generated stand-ins).
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
  // Which media the shared viewer is showing, if any.
  const [viewing, setViewing] = useState<Media | null>(null);

  if (media.length === 0) {
    return (
      <div
        className={`rounded-lg border border-neutral-700 bg-neutral-800 ${itemHeight}`}
      >
        <TileNotice compact={compact}>No media available</TileNotice>
      </div>
    );
  }

  const items = media.map((m) => (
    <div
      key={m.id}
      // `group` is what the image tile's hover-revealed download reads. The
      // backdrop is unconditional: it is what the letterbox bars of a portrait
      // video are painted on, in both variants.
      className={`group relative ${itemHeight} rounded-lg overflow-hidden border border-neutral-700 bg-neutral-900`}
    >
      {m.media_type === "image" ? (
        <>
          <Image
            src={compact ? displayUrlsFor(m).thumbnail : displayUrlsFor(m).hero}
            alt={alt}
            fill
            sizes={compact ? "380px" : "(min-width: 768px) 384px, 100vw"}
            className="object-cover"
          />
          {/* An image tile is cropped, so the whole tile opens the uncropped
              viewer. The button is a plain sibling laid over the picture: the
              control cluster below comes later in DOM order and paints on top,
              so a download click is never also a view click. */}
          <button
            type="button"
            onClick={() => setViewing(m)}
            // Named by its alt, like a proof image: a gallery holds several
            // tiles, and "View image" repeated N times tells a screen-reader
            // user nothing about which one they are on.
            aria-label={alt ? `View image: ${alt}` : "View image"}
            className="absolute inset-0 h-full w-full cursor-zoom-in"
          />
          <div
            className={`absolute right-2 top-2 z-10 flex items-center gap-1 ${HOVER_REVEAL}`}
          >
            <MediaDownloadButton source={m} />
          </div>
        </>
      ) : (
        <VideoPlayer
          src={m.storage_url}
          source={m}
          title={alt}
          compact={compact}
          onExpand={() => setViewing(m)}
        />
      )}
    </div>
  ));

  const viewer = viewing ? (
    <MediaLightbox source={viewing} alt={alt} onClose={() => setViewing(null)} />
  ) : null;

  if (compact) {
    return (
      <div className="space-y-2">
        {items}
        {viewer}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {items}
      {viewer}
    </div>
  );
}
