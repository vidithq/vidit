import {
  OG_COLOR,
  OG_CONTENT_TYPE,
  OG_SIZE,
  OgCard,
  ogImageResponse,
} from "./_og/card";

// Default `og:image` for every route under `app/` that generates none of its
// own, rendered via `next/og` with no committed binary. The canvas, the font,
// the palette, the wordmark and the footer come from the shared card frame in
// `_og/card.tsx`; this route supplies the headline. Twitter reuses it via
// `twitter-image.tsx`.
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
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
        {/* Two-line layout via stacked divs because satori's flex line-break
            support is unreliable. */}
        <div
          style={{
            fontSize: "84px",
            letterSpacing: "-0.025em",
            lineHeight: 1.05,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div>The home for</div>
          <div>conflict geolocations.</div>
        </div>
        {/* Subhead: smaller + neutral colour so it reads as subordinate to the
            headline despite the shared 700 weight. */}
        <div
          style={{
            marginTop: "32px",
            fontSize: "28px",
            color: OG_COLOR.muted,
            lineHeight: 1.4,
            maxWidth: "900px",
            display: "flex",
          }}
        >
          An open platform for OSINT/GEOINT analysts to archive, reference, and
          visualise armed-conflict events.
        </div>
      </div>
    </OgCard>,
  );
}
