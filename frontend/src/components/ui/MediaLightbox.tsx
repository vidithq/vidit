"use client";

import Image from "next/image";

import { MediaDownloadButton } from "@/components/ui/MediaDownloadButton";
import { MediaOverlay } from "@/components/ui/MediaOverlay";
import { VideoPlayer } from "@/components/ui/VideoPlayer";
import { displayUrlsFor } from "@/lib/mediaUrls";
import type { Media } from "@/types";

/**
 * The one media viewer, for every surface that enlarges a picture or plays a
 * clip.
 *
 *   `MediaOverlay`      backdrop, dialog semantics, Escape, corner controls;
 *                       takes arbitrary children (`FileManager` and
 *                       `OutboundLink` share it). Its own module, so a
 *                       dialog that imports it does not pull the video player.
 *   `MediaLightboxBody` the media at viewer size, from a source.
 *   `MediaLightbox`     the two composed, plus the download control.
 *
 * A source is a persisted `Media` row or a plain `{src, kind}` shape (a staged
 * object URL, or a proof image from an allowlisted URL).
 */
type LightboxSource =
  | Media
  | { src: string; kind: "image" | "video"; filename?: string };

interface ResolvedSource {
  src: string;
  isVideo: boolean;
  media: Media | null;
  filename?: string;
}

function resolveSource(source: LightboxSource): ResolvedSource {
  if ("storage_url" in source) {
    const isVideo = source.kind !== "image";
    return {
      // `hero` (max-dim 1280) avoids the original's payload. Videos have no
      // derivatives.
      src: isVideo ? source.storage_url : displayUrlsFor(source).hero,
      isVideo,
      media: source,
      filename: source.original_filename ?? undefined,
    };
  }
  return {
    src: source.src,
    isVideo: source.kind === "video",
    media: null,
    filename: source.filename,
  };
}

// A plain image caps directly; a next/image `fill` and the player need a sized
// parent, so they take the box form.
const MEDIA_CAP = "max-h-[80dvh] max-w-[85vw]";
const MEDIA_FRAME = "relative h-[80dvh] w-[85vw] max-w-4xl";

/**
 * One media at viewer size. A clip plays in the shared `VideoPlayer` (which
 * carries its own download, so `MediaLightbox` adds a corner one for images
 * only).
 *
 * A persisted `Media` image goes through `next/image`. The plain `{src}` shape
 * does not: object-URL bytes cannot round-trip the optimiser, and a proof image
 * has unknown dimensions.
 */
export function MediaLightboxBody({
  source,
  alt = "",
}: {
  source: LightboxSource;
  alt?: string;
}) {
  const { src, isVideo, media, filename } = resolveSource(source);

  if (isVideo) {
    return (
      <VideoPlayer
        src={src}
        source={media ?? { src, filename }}
        title={alt || filename}
        className={MEDIA_FRAME}
      />
    );
  }
  if (media) {
    return (
      <div className={MEDIA_FRAME}>
        <Image src={src} alt={alt} fill sizes="90vw" className="object-contain" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className={`${MEDIA_CAP} object-contain`} />
  );
}

/** The full viewer: overlay, one media and a download (a persisted row
 *  downloads its original, a plain source its `src`). The corner download is
 *  for images only; a clip's lives in the player's bar. Mount it
 *  conditionally; the caller owns the open state. */
export function MediaLightbox({
  source,
  alt = "",
  onClose,
}: {
  source: LightboxSource;
  /** Alt text for an image, and the dialog's name. */
  alt?: string;
  onClose: () => void;
}) {
  const { src, isVideo, media, filename } = resolveSource(source);
  const label = alt || filename || (isVideo ? "Video" : "Image");

  return (
    <MediaOverlay
      label={label}
      onClose={onClose}
      actions={
        isVideo ? undefined : (
          <MediaDownloadButton source={media ?? { src, filename }} />
        )
      }
    >
      <MediaLightboxBody source={source} alt={alt} />
    </MediaOverlay>
  );
}
