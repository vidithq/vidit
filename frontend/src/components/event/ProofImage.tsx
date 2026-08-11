"use client";

import { useState } from "react";
import { Expand } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { MediaDownloadButton } from "@/components/ui/MediaDownloadButton";
import { MediaLightbox } from "@/components/ui/MediaLightbox";
import { FLOATING_CONTROL, HOVER_REVEAL } from "@/components/ui/styles";

/**
 * One image inside a rendered proof body, enlargeable in the shared
 * `MediaLightbox`. A geolocation's proof is a source-media to satellite
 * cross-reference, so the images are the evidence: at body width they are
 * thumbnails, and the claim can only be checked at full size.
 *
 * The whole image stays the zoom target; on hover it also floats the same
 * action cluster the gallery tiles carry (download, expand), so an analyst can
 * save a proof frame without leaving the page and can see there is something to
 * click. `HOVER_REVEAL` keeps the cluster out of the reading surface at rest,
 * and permanently visible on touch, where nothing can trigger a hover.
 *
 * Its own client component because the renderer (`lib/proof.tsx`) is plain
 * server-safe markup consumed from server surfaces. Keeping the open state
 * here means a proof body stays a server render with one interactive leaf, not
 * a whole page pushed to the client.
 *
 * Plain `<img>` on purpose, matching the rest of the renderer: a proof image
 * has unknown natural dimensions from an arbitrary allowlisted host, which
 * `next/image` cannot size. The lazy + no-referrer hints cover the load
 * discipline `next/image` would add. `src` is validated by the caller. Inline
 * wrappers (`span`) because a proof image can sit inside a paragraph.
 */
export function ProofImage({
  src,
  alt,
  title,
}: {
  src: string;
  alt: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <span className="group relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={alt ? `View image: ${alt}` : "View image"}
        className="block cursor-zoom-in"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          title={title}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="my-3 max-w-full h-auto rounded-sm border border-neutral-800"
        />
      </button>
      {/* Clears the image's own `my-3`, so the cluster sits inside the frame
          rather than over the gap above it. A proof image has no Media row, so
          it downloads by URL under the URL's basename. */}
      <span
        className={`absolute right-2 top-5 z-10 flex items-center gap-1 ${HOVER_REVEAL}`}
      >
        <MediaDownloadButton source={{ src }} />
        <Button
          icon
          variant="ghost"
          className={FLOATING_CONTROL}
          aria-label="Expand image"
          title="Expand image"
          onClick={() => setOpen(true)}
        >
          <Expand size={16} />
        </Button>
      </span>
      {open && (
        <MediaLightbox
          source={{ src, kind: "image" }}
          alt={alt}
          onClose={() => setOpen(false)}
        />
      )}
    </span>
  );
}
