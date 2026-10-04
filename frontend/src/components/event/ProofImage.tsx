"use client";

import { useState } from "react";
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
 * allowlisted host, which `next/image` cannot size. Lazy and no-referrer hints cover the load
 * discipline. `src` is validated by the caller. The `span` + `inline-block` wrappers keep the
 * hover cluster's positioning context on the picture alone; the node is block level in the
 * document (`renderBlock` in [`lib/proof.tsx`](../../lib/proof.tsx) is the only place it renders),
 * so it never nests in a paragraph.
 *
 * The viewer portals to `document.body` ([`MediaLightbox`](../ui/MediaLightbox.tsx)), so a
 * transformed or scrolling ancestor can't clip it.
 */
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
          src={src}
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
