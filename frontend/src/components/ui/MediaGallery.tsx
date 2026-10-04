"use client";

import { useState } from "react";
import Image from "next/image";

import type { Media } from "@/types";
import { displayUrlsFor } from "@/lib/mediaUrls";
import { GraphicContentGate } from "@/components/ui/GraphicContentGate";
import { MediaDownloadButton } from "@/components/ui/MediaDownloadButton";
import { MediaLightbox } from "@/components/ui/MediaLightbox";
import { TileNotice } from "@/components/ui/TileNotice";
import { VideoPlayer } from "@/components/ui/VideoPlayer";
import { HOVER_REVEAL } from "@/components/ui/styles";

/**
 * The detail-surface media block, shared by the geolocation detail page, the
 * map's detail side panel, and the request detail page.
 *
 * - `page`: 2-up grid at `hero` resolution (~384 CSS px per cell, sharp at 2x).
 * - `panel`: stacked tiles at `thumbnail` resolution (max-dim 400). The panel
 *   (~380 CSS px) is the most-fetched surface (every map popup).
 *
 * **Video tiles** are `VideoPlayer`, whose bar carries one expand control
 * (`onExpand`) opening the same lightbox as an image tile. Full screen lives on
 * the lightbox's player only. An undecodable clip swaps to a text notice.
 *
 * **Image tiles** keep `object-cover` (the crop is deliberate); the tile opens
 * `MediaLightbox` at `hero` uncropped. Their download floats in the corner,
 * revealed on hover (`HOVER_REVEAL` keeps it visible on touch).
 *
 * No media renders one marked empty box.
 *
 * `isGraphic` wraps the whole block in `GraphicContentGate`, so the reader
 * answers once per gallery. The lightbox stays outside it: a gated tile takes no
 * clicks.
 */
export function MediaGallery({
  media,
  alt,
  variant = "page",
  isGraphic = false,
}: {
  media: Media[];
  /** Alt text for image media (the entity title). */
  alt: string;
  variant?: "page" | "panel";
  isGraphic?: boolean;
}) {
  const compact = variant === "panel";
  const itemHeight = compact ? "h-40" : "h-48";
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
      // `group` drives the image tile's hover-revealed download. The backdrop is
      // what a portrait video's letterbox bars paint on.
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
          {/* A sibling over the picture; the control cluster below paints on top,
              so a download click is never also a view click. */}
          <button
            type="button"
            onClick={() => setViewing(m)}
            // Named by its alt: repeated "View image" says nothing about which
            // tile.
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

  const tiles = compact ? (
    <div className="space-y-2">{items}</div>
  ) : (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{items}</div>
  );

  return (
    <>
      {/* Full interstitial in both variants: the panel's 160px tiles fit it. */}
      {isGraphic ? <GraphicContentGate>{tiles}</GraphicContentGate> : tiles}
      {viewer}
    </>
  );
}
