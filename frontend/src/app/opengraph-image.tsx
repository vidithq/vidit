import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ImageResponse } from "next/og";

// Next.js file convention: every route under `app/` inherits this as its
// default `og:image` unless overridden by a sibling `opengraph-image`
// file. Renders at build/request time via ``next/og``: no binary asset
// for the image itself — only the font file is committed and bundled
// via `outputFileTracingIncludes` in `next.config.mjs` (same pattern as
// `icon.tsx`). 1200×630 is the canonical Open Graph card aspect.
//
// Twitter consumes the same image via the sibling `twitter-image.tsx`
// (which re-uses this composition). The pinned tweet on ``@vidithq``
// renders a summary_large_image card; without this file the card was a
// bland text-only one.
//
// `runtime = "nodejs"` (not "edge") so `readFileSync` is available for
// the font load — same constraint as `icon.tsx`. The `process.cwd()`
// path mirrors that file too; without the bundling rule the .ttf is
// missing on Vercel and every request 500s with ENOENT.

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
        // Only the 700 cut is bundled (the same TTF the favicon already
        // ships) — satori falls back to its built-in default font for
        // any weight it doesn't have loaded, so every node here uses 700.
        // Stylistic differentiation comes from size and colour, not weight.
        fontFamily: "Montserrat",
        fontWeight: 700,
      }}
    >
      {/* Wordmark — matches the sidebar header treatment (orange `V` +
          neutral-100 `idit`, both same weight, V acts as the brand
          mark). Satori only allows display:flex|block|none, so the
          wordmark is a flex row whose two children get the colour
          contrast. */}
      <div style={{ display: "flex", alignItems: "baseline", fontSize: "64px" }}>
        <div style={{ color: "#f97316" }}>V</div>
        <div style={{ color: "#f5f5f5" }}>idit</div>
      </div>
      {/* Headline mirrors the landing's H1. Two-line layout via stacked
          divs because satori's flex line-break support is unreliable. */}
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
      {/* Subhead — slightly trimmed version of the landing subhead.
          Same 700 weight but smaller + neutral-400 colour so the
          hierarchy still reads as subordinate to the headline. */}
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
      {/* Footer URL */}
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
