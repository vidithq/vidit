import { OG_CONTENT_TYPE, OG_SIZE, OgCard, OgDefaultBody, ogImageResponse } from "./_og/card";

// Default `og:image` for routes without their own, via `next/og`; canvas, font, palette and headline come from `_og/card.tsx`.
// `runtime = "nodejs"` because the frame reads the font off disk.

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
