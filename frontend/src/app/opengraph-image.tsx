import { OG_CONTENT_TYPE, OG_SIZE, OgCard, OgDefaultBody, ogImageResponse } from "./_og/card";

// Default `og:image` for routes without their own, via `next/og`; canvas, font, palette and headline come from `_og/card.tsx`.
// `runtime = "nodejs"` because the frame reads the font off disk.

export const runtime = "nodejs";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt =
  "Vidit, an open archive of conflict geolocations: the open source platform where OSINT/GEOINT analysts publish, archive and share geolocated events from armed conflicts.";

export default function OpenGraphImage() {
  return ogImageResponse(
    <OgCard>
      <OgDefaultBody />
    </OgCard>,
  );
}
