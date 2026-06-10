import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ImageResponse } from "next/og";

// Default `og:image` for every route under `app/`, rendered via `next/og`
// with no committed binary — only the font, bundled via
// `outputFileTracingIncludes` (same pattern as `icon.tsx`). 1200×630 is the
// canonical Open Graph aspect. Twitter reuses this via `twitter-image.tsx`.
//
// `runtime = "nodejs"` (not "edge") for `readFileSync`, and `process.cwd()`
// — same as `icon.tsx`; without the bundling rule the .ttf is missing on
// Vercel and every request 500s with ENOENT.

const MONTSERRAT_700 = readFileSync(
  join(process.cwd(), "src/app/Montserrat-700.ttf"),
);

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt =
  "Vidit — an open platform for OSINT/GEOINT analysts to archive, reference, and visualise geolocations of armed-conflict events.";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "80px",
        background: "#0a0a0a",
        color: "#f5f5f5",
        // Only the 700 cut is bundled; satori falls back to its default
        // font for any unloaded weight, so every node uses 700 and
        // differentiates by size and colour, not weight.
        fontFamily: "Montserrat",
        fontWeight: 700,
      }}
    >
      {/* Wordmark matching the sidebar (orange `V` + neutral `idit`).
          Satori only allows display:flex|block|none, so it's a flex row
          whose two children carry the colour contrast. */}
      <div style={{ display: "flex", alignItems: "baseline", fontSize: "64px" }}>
        <div style={{ color: "#f97316" }}>V</div>
        <div style={{ color: "#f5f5f5" }}>idit</div>
      </div>
      {/* Two-line layout via stacked divs because satori's flex
          line-break support is unreliable. */}
      <div
        style={{
          marginTop: "32px",
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
      {/* Subhead: smaller + neutral colour so it reads as subordinate
          to the headline despite the shared 700 weight. */}
      <div
        style={{
          marginTop: "32px",
          fontSize: "28px",
          color: "#a3a3a3",
          lineHeight: 1.4,
          maxWidth: "900px",
          display: "flex",
        }}
      >
        An open platform for OSINT/GEOINT analysts to archive, reference, and
        visualise armed-conflict events.
      </div>
      <div
        style={{
          marginTop: "auto",
          display: "flex",
          fontSize: "22px",
          color: "#737373",
        }}
      >
        vidit.app
      </div>
    </div>,
    {
      ...size,
      fonts: [
        {
          name: "Montserrat",
          data: MONTSERRAT_700,
          weight: 700,
          style: "normal",
        },
      ],
    },
  );
}
