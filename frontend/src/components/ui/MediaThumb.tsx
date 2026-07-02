import type { CSSProperties } from "react";

import { cn } from "@/lib/cn";
import { displayUrlsFor } from "@/lib/mediaUrls";
import type { Media } from "@/types";

// The one fixed-ratio media slot on cards: the real media when there is one
// (image thumbnail, or muted video first-frame via a `#t=0.1` media fragment +
// `preload="metadata"` so it paints as a poster), a generated stand-in when
// given a `seed` (cards whose payload carries no real media), or a "no media"
// box. The stand-in is self-hosted and fetch-free on purpose: third-party
// generators (picsum.photos, pravatar, etc.) would leak the signed-in
// analyst's IP + UA, contradicting the /about operational-security claim.

// FNV-1a-ish: short, allocation-free, good enough for a hue. Deterministic:
// same seed, same shade, so a re-rendered list is stable across navigations.
function hueFromSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h % 360;
}

function seedStyle(seed: string): CSSProperties {
  const hue = hueFromSeed(seed);
  return {
    // Low-saturation, low-lightness gradient on a neutral base: reads as
    // "image will go here" without competing with the real thumbnails.
    backgroundImage: `linear-gradient(135deg, hsl(${hue} 25% 22%) 0%, hsl(${(hue + 30) % 360} 18% 14%) 100%)`,
  };
}

export function MediaThumb({
  media,
  seed,
  className,
}: {
  media?: Media;
  /** Stand-in shade for a card with no real media payload. Ignored when
   *  `media` is present. */
  seed?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative w-28 aspect-video rounded-md overflow-hidden bg-neutral-800 shrink-0",
        className,
      )}
    >
      {media ? (
        media.media_type === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={displayUrlsFor(media).thumbnail}
            alt=""
            className="w-full h-full object-cover"
          />
        ) : (
          <video
            src={`${media.storage_url}#t=0.1`}
            className="w-full h-full object-cover"
            preload="metadata"
            muted
          />
        )
      ) : seed ? (
        <div aria-hidden="true" className="absolute inset-0" style={seedStyle(seed)} />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-neutral-600 text-xs">
          no media
        </div>
      )}
    </div>
  );
}
