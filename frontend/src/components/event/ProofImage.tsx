"use client";

import { useState } from "react";
import { getImageProps } from "next/image";
import { Expand } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { GraphicContentGate } from "@/components/ui/GraphicContentGate";
import { MediaDownloadButton } from "@/components/ui/MediaDownloadButton";
import { MediaLightbox } from "@/components/ui/MediaLightbox";
import { FLOATING_CONTROL, HOVER_REVEAL } from "@/components/ui/styles";

/**
 * One image inside a rendered proof body, enlargeable in the shared `MediaLightbox`. Proof images
 * are the evidence: thumbnails at body width, checkable only at full size. The whole image is the
 * zoom target; on hover it floats the gallery tiles' action cluster (download, expand), revealed
 * by `HOVER_REVEAL` (always visible on touch).
 *
 * Its own client component because the renderer (`lib/proof.tsx`) is server-safe markup: the open
 * state here keeps a proof body a server render with one interactive leaf.
 *
 * Plain `<img>` on purpose: a proof image has unknown natural dimensions from an arbitrary
 * allowlisted host, which `next/image` cannot size. On the deployment's media host it still loads
 * through the image optimizer (`displaySrc`), since an original can weigh megabytes. Lazy and
 * no-referrer hints cover the load discipline. `src` is validated by the caller. The viewer and
 * the download keep the original. The `span` + `inline-block` wrappers keep the
 * hover cluster's positioning context on the picture alone; `renderProof` in
 * [`lib/proof.tsx`](../../lib/proof.tsx) is the only place it renders, and it turns a paragraph
 * holding an image into a `div`, so it never nests in a `<p>`.
 *
 * The viewer portals to `document.body` ([`MediaLightbox`](../ui/MediaLightbox.tsx)), so a
 * transformed or scrolling ancestor can't clip it.
 */
// Two optimizer widths cover a body column up to 960 CSS px at 2x.
const PROOF_SLOT_PX = 960;

/** The optimizer URL for a picture on the media host, the only host the optimizer serves; any
 *  other `src` as is. One URL and no `srcset`: the optimizer never upscales, so a `srcset`
 *  candidate wider than the original would paint it below its natural size. The URL is the 2x
 *  candidate, so a picture keeps its natural size up to that width. */
function displaySrc(src: string): string {
  const mediaHost = process.env.NEXT_PUBLIC_MEDIA_HOST;
  if (!mediaHost) return src;
  let hostname: string;
  try {
    hostname = new URL(src).hostname;
  } catch {
    return src;
  }
  if (hostname !== mediaHost.toLowerCase()) return src;
  const { props } = getImageProps({ src, alt: "", width: PROOF_SLOT_PX, height: PROOF_SLOT_PX });
  return props.src;
}

export function ProofImage({
  src,
  alt,
  title,
  isGraphic = false,
}: {
  src: string;
  alt: string;
  title?: string;
  /** The event's `is_graphic` flag, threaded by `renderProof`: a proof body shows the same footage
   * as the source media, so it takes the same age confirmation. */
  isGraphic?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const figure = (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={alt ? `View image: ${alt}` : "View image"}
        className="block cursor-zoom-in"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={displaySrc(src)}
          alt={alt}
          title={title}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="my-3 max-w-full h-auto rounded-sm border border-neutral-800"
        />
      </button>
      {/* Clears the image's own `my-3`, so the cluster sits inside the frame. A proof image has no Media
          row, so it downloads by URL under the URL's basename. */}
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
    </>
  );

  return (
    <span className="group relative inline-block">
      {/* The full interstitial: a proof image runs the body's width, so the whole sentence fits. The
          gate's wrapper is `relative` too, so the hover cluster still positions against the picture. */}
      {isGraphic ? <GraphicContentGate>{figure}</GraphicContentGate> : figure}
      {/* Outside the gate: the viewer opens only from a click the gate blocks, and it portals to
          `document.body`, clear of the blur filter. */}
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
