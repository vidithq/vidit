"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { X } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { MediaDownloadButton } from "@/components/ui/MediaDownloadButton";
import { VideoPlayer } from "@/components/ui/VideoPlayer";
import { FLOATING_CONTROL } from "@/components/ui/styles";
import { displayUrlsFor } from "@/lib/mediaUrls";
import type { Media } from "@/types";

/**
 * The one media viewer, for every surface that enlarges a picture or plays a
 * clip.
 *
 *   `MediaOverlay`      backdrop, dialog semantics, Escape, corner controls;
 *                       takes arbitrary children (`FileManager` shares it).
 *   `MediaLightboxBody` the media at viewer size, from a source.
 *   `MediaLightbox`     the two composed, plus the download control.
 *
 * A source is a persisted `Media` row or a plain `{src, kind}` shape (a staged
 * object URL, or a proof image from an allowlisted URL).
 */
export type LightboxSource =
  | Media
  | { src: string; kind: "image" | "video"; filename?: string };

interface ResolvedSource {
  src: string;
  isVideo: boolean;
  media: Media | null;
  filename?: string;
}

function resolveSource(source: LightboxSource): ResolvedSource {
  if ("media_type" in source) {
    const isVideo = source.media_type !== "image";
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

// `[tabindex]` carries the media-chrome controls: each custom element puts the
// tabstop on its own host.
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The overlay shell: backdrop closing on click or Escape, content clicks
 * stopped, controls in one row at the content's top-right corner.
 *
 * **Escape** belongs to fullscreen first: the browser exits a player's
 * fullscreen on Escape itself, and handling it here too would close both layers
 * at once.
 *
 * **Focus** moves to the close button on mount, stays inside while open (Tab
 * wraps) and returns to the previous element on unmount. Hand-rolled: one
 * dialog with one exit.
 *
 * **Layer.** Portalled to `document.body` at a z-index above every floating
 * surface (map panels 1000, sidebar 1100, banner 1200). `fixed` resolves
 * against a transformed ancestor (a proof body, the map's detail panel), so
 * portalling is what lets the overlay cover the screen from every caller.
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
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Fullscreen owns this press; the browser is already exiting it.
        if (document.fullscreenElement) return;
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const stops = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
      );
      if (stops.length === 0) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      // Focus inside a shadow root reports as its host, which is in the list.
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    const restoreTo = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>("[data-overlay-close]")?.focus();
    // The opener can be gone by then: best-effort.
    return () => restoreTo?.focus?.();
  }, []);

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className="fixed inset-0 z-1500 bg-black/85 safe-pt safe-pr safe-pb safe-pl"
      onClick={onClose}
    >
      {/* The backdrop fills the screen with the safe-area insets as padding, so a
          tap in the cutout or home-indicator band closes the viewer. The centring
          frame is a child because its `p-6` and the inset padding set the same
          property. */}
      {/* `items-start` plus `my-auto`, not `items-center`: auto margins collapse
          to 0 when the content overflows, while a centred overflowing item
          leaves a band above scroll origin that no gesture reaches (where the
          close cluster hangs). The child is sized by its content, so a tall
          frame scrolls instead of being cut. */}
      <div className="flex h-full w-full items-start justify-center overflow-y-auto p-6">
        <div
          className="relative my-auto max-w-full"
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
              data-overlay-close=""
              onClick={onClose}
            >
              <X size={16} />
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
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
