"use client";

import { useState } from "react";
import Image from "next/image";

import type { Media } from "@/types";
import { cn } from "@/lib/cn";
import { displayUrlsFor } from "@/lib/mediaUrls";
import { GraphicContentGate } from "@/components/ui/GraphicContentGate";
import { MediaDownloadButton } from "@/components/ui/MediaDownloadButton";
import { MediaLightbox } from "@/components/ui/MediaLightbox";
import { TileNotice } from "@/components/ui/TileNotice";
import { VideoPlayer } from "@/components/ui/VideoPlayer";
import { HOVER_REVEAL } from "@/components/ui/styles";

// A grown video frame's bounds, in rem. The floor keeps the bar's controls at full size, so a
// clip narrower than it gets thin side bars.
const GROW_MAX_HEIGHT = 28;
const GROW_MIN_WIDTH = 20;

/**
 * A source's file on a reading surface (`SourceBlock`): one tile.
 *
 * - `page`: `hero` resolution.
 * - `panel`: `thumbnail` resolution (max-dim 400). The panel (~380 CSS px) is the most-fetched
 *   surface (every map popup).
 *
 * **A video tile** is `VideoPlayer`, whose bar carries one expand control
 * (`onExpand`) opening the same lightbox as an image tile. Full screen lives on
 * the lightbox's player only. An undecodable clip swaps to a text notice.
 *
 * **An image tile** keeps `object-cover` (the crop is deliberate); the tile opens
 * `MediaLightbox` at `hero` uncropped. Their download floats in the corner,
 * revealed on hover (`HOVER_REVEAL` keeps it visible on touch).
 *
 * `grow` gives a `page` tile a 16:9 box at the full width instead of the
 * fixed height, for a gallery that owns a wide slot. A video tile then takes the
 * clip's own shape once its metadata loads, centered, at most `GROW_MAX_HEIGHT`
 * tall and at least `GROW_MIN_WIDTH` wide, so a portrait clip plays in a portrait
 * frame.
 *
 * No media renders one marked empty box, saying `empty`.
 *
 * `isGraphic` wraps the tile in `GraphicContentGate`. The lightbox stays outside it: a gated
 * tile takes no clicks.
 */
export function MediaGallery({
  media,
  alt,
  variant = "page",
  isGraphic = false,
  grow = false,
  empty = "No media available",
}: {
  media: Media | null;
  /** Alt text for image media (the entity title). */
  alt: string;
  variant?: "page" | "panel";
  isGraphic?: boolean;
  grow?: boolean;
  /** What the empty box says, such as *No file* on a source block. */
  empty?: string;
}) {
  const compact = variant === "panel";
  const itemHeight = compact ? "h-40" : grow ? "aspect-video" : "h-48";
  const [viewing, setViewing] = useState(false);
  const [clip, setClip] = useState<number | undefined>(undefined);

  if (!media) {
    return (
      <div
        className={`rounded-lg border border-neutral-700 bg-neutral-800 ${itemHeight}`}
      >
        <TileNotice compact={compact}>{empty}</TileNotice>
      </div>
    );
  }

  const m = media;
  const ratio =
    grow && !compact && m.kind === "video" && clip
      ? Math.max(clip, GROW_MIN_WIDTH / GROW_MAX_HEIGHT)
      : undefined;
  const tile = (
    <div
      // `group` drives the image tile's hover-revealed download. The backdrop is
      // what a portrait video's letterbox bars paint on.
      className={cn(
        "group relative rounded-lg overflow-hidden border border-neutral-700 bg-neutral-900",
        ratio ? "mx-auto" : itemHeight,
      )}
      // The width caps the height: `min()` keeps the frame inside the slot and under the cap.
      style={
        ratio
          ? { aspectRatio: ratio, width: `min(100%, ${GROW_MAX_HEIGHT * ratio}rem)` }
          : undefined
      }
    >
      {m.kind === "image" ? (
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
            onClick={() => setViewing(true)}
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
          onExpand={() => setViewing(true)}
          onAspectRatio={grow && !compact ? setClip : undefined}
        />
      )}
    </div>
  );

  return (
    <>
      {/* Full interstitial in both variants: the panel's 160px tile fits it. */}
      {isGraphic ? <GraphicContentGate>{tile}</GraphicContentGate> : tile}
      {viewing && <MediaLightbox source={m} alt={alt} onClose={() => setViewing(false)} />}
    </>
  );
}
