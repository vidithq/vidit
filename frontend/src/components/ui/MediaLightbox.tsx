"use client";

import { useEffect, type ReactNode } from "react";
import Image from "next/image";
import { X } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { MediaDownloadButton } from "@/components/ui/MediaDownloadButton";
import { VideoPlayer } from "@/components/ui/VideoPlayer";
import { FLOATING_CONTROL } from "@/components/ui/styles";
import { displayUrlsFor } from "@/lib/mediaUrls";
import type { Media } from "@/types";

/**
 * The one media viewer. Every surface that enlarges a picture or plays a clip
 * (the detail-page gallery, the media manager's staged and persisted tiles, a
 * proof body's embedded images) mounts this, so the viewer can't drift into
 * per-surface copies of the same overlay.
 *
 * Three exports, one recipe:
 *   `MediaOverlay`      the backdrop, the dialog semantics, Escape, the corner
 *                       controls. Takes arbitrary children, which is what lets
 *                       `FileManager` (whose item API is a ReactNode) share the
 *                       exact same shell.
 *   `MediaLightboxBody` the media itself at viewer size, from a source.
 *   `MediaLightbox`     the two composed, plus the download control.
 *
 * A source is either a persisted `Media` row or a plain `{src, kind}` shape, so
 * a staged object URL (no id, no derivatives) and a proof image (an arbitrary
 * allowlisted URL) reach the same viewer as a stored row.
 */
export type LightboxSource =
  | Media
  | { src: string; kind: "image" | "video"; filename?: string };

interface ResolvedSource {
  src: string;
  isVideo: boolean;
  /** The persisted row, when there is one. */
  media: Media | null;
  filename?: string;
}

function resolveSource(source: LightboxSource): ResolvedSource {
  if ("media_type" in source) {
    const isVideo = source.media_type !== "image";
    return {
      // Images view at `hero` (max-dim 1280): sharp at viewer size without the
      // original's multi-megabyte payload. Videos have no derivatives.
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

// The viewer's size envelope: big enough to inspect, short enough that the
// backdrop still frames it. A plain image caps directly; a next/image `fill`
// and the player both need a sized parent instead, so they take the box form.
const MEDIA_CAP = "max-h-[80vh] max-w-[85vw]";
const MEDIA_FRAME = "relative h-[80vh] w-[85vw] max-w-4xl";

/**
 * One media at viewer size. A clip plays in the shared `VideoPlayer`, which
 * letterboxes inside the frame, so a portrait clip keeps its shape instead of
 * being cropped; the bars are black on a black backdrop, so what the reader
 * sees is a centered clip. The player carries its own download, which is why
 * `MediaLightbox` below adds a corner one for images only.
 *
 * A persisted `Media` image goes through `next/image` (its origin is a
 * configured loader host). The plain `{src}` shape does not: object-URL bytes
 * cannot round-trip the optimiser, and a proof image has unknown natural
 * dimensions from an arbitrary allowlisted host.
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

/**
 * The overlay shell: dark backdrop over the whole viewport, closing on a
 * backdrop click or Escape, with the content click stopped so a click on the
 * media (a video's own controls included) never dismisses it. Controls sit in
 * one row at the content's top-right corner, so a download and the close never
 * land on each other.
 */
export function MediaOverlay({
  label,
  actions,
  onClose,
  children,
}: {
  /** Accessible name for the dialog. */
  label: string;
  /** Extra corner controls, rendered left of the close button. */
  actions?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-6"
      onClick={onClose}
    >
      <div
        className="relative max-h-full max-w-full"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
        <div className="absolute -top-3 -right-3 z-10 flex items-center gap-1">
          {actions}
          <Button
            icon
            variant="ghost"
            className={FLOATING_CONTROL}
            aria-label="Close"
            title="Close"
            onClick={onClose}
          >
            <X size={16} />
          </Button>
        </div>
      </div>
    </div>
  );
}

/** The full viewer: overlay + one media + a download. A persisted row
 *  downloads its original object; a plain source downloads its `src` as is.
 *  The corner download is for images: a clip's download lives in the player's
 *  own control bar, so a video would otherwise carry two of them.
 *  Mount it conditionally; the caller owns the open state. */
export function MediaLightbox({
  source,
  alt = "",
  onClose,
}: {
  source: LightboxSource;
  /** Alt text for an image, and the dialog's accessible name. */
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
