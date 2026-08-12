import { OG_CONTENT_TYPE, OG_SIZE, OgCard, OgDefaultBody, ogImageResponse } from "./_og/card";

// Default `og:image` for every route under `app/` that generates none of its
// own, rendered via `next/og` with no committed binary. The canvas, the font,
// the palette, the wordmark, the footer and the headline come from the shared
// card frame in `_og/card.tsx`, which is also where a data card falls back to
// when its upstream read fails. Twitter reuses this via `twitter-image.tsx`.
//
// `runtime = "nodejs"` (not "edge") because the frame reads the font off disk.

export const runtime = "nodejs";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt =
  "Vidit, an open platform for OSINT/GEOINT analysts to archive, reference, and visualise geolocations of armed-conflict events.";

export default function OpenGraphImage() {
  return ogImageResponse(
    <OgCard>
      <OgDefaultBody />
    </OgCard>,
  );
}
