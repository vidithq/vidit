import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ImageResponse } from "next/og";

// The shared Satori frame every `opengraph-image.tsx` renders into: one canvas size, font,
// palette, wordmark and footer. Satori is a known-bespoke surface (see AGENTS.md) so it
// doesn't compose the Tailwind primitives. `_og` is a Next private folder: no route.
//
// `runtime = "nodejs"` (not "edge") for the `readFileSync` below and `process.cwd()`; the
// `outputFileTracingIncludes` rule in `next.config.mjs` puts the .ttf in the Vercel bundle,
// without which every card request 500s with ENOENT.

const MONTSERRAT_700 = readFileSync(
  join(process.cwd(), "src/app/Montserrat-700.ttf"),
);

/** 1200×630, the canonical Open Graph aspect. X and Discord both crop to it. */
export const OG_SIZE = { width: 1200, height: 630 };

export const OG_CONTENT_TYPE = "image/png";

/**
 * Card palette: hex values of the Tailwind classes the app uses (`neutral-950` surface,
 * `neutral-900` panel, `neutral-800` border and minor graticule, `neutral-700` major
 * graticule, `neutral-600` coastline, `orange-500` accent, `neutral-100` / `neutral-400` /
 * `neutral-500` type). Satori takes no class names, so the scale is restated here, the one
 * place cards read colour from. `land` is the one off-scale value, between `neutral-900` and
 * `neutral-800`: it lifts the landmass off the panel and keeps the minor graticule visible
 * across land.
 */
export const OG_COLOR = {
  surface: "#0a0a0a",
  panel: "#171717",
  border: "#262626",
  grid: "#262626",
  gridMajor: "#404040",
  land: "#1f1f1f",
  landEdge: "#525252",
  accent: "#f97316",
  accentDim: "#7c3d13",
  text: "#f5f5f5",
  muted: "#a3a3a3",
  faint: "#737373",
} as const;

/** The sidebar wordmark: accent `V` plus neutral `idit`. Satori allows only
 * `display: flex | block | none`, so two flex children carry the contrast. */
export function OgWordmark({ fontSize = 40 }: { fontSize?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", fontSize: `${fontSize}px` }}>
      <div style={{ color: OG_COLOR.accent }}>V</div>
      <div style={{ color: OG_COLOR.text }}>idit</div>
    </div>
  );
}

/** The small uppercase tag in the card's top-right corner (a status, a kind). */
export function OgBadge({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "accent" }) {
  const accent = tone === "accent";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "10px 22px",
        borderRadius: "999px",
        fontSize: "22px",
        letterSpacing: "0.08em",
        border: `2px solid ${accent ? OG_COLOR.accent : OG_COLOR.border}`,
        color: accent ? OG_COLOR.accent : OG_COLOR.muted,
        background: accent ? "rgba(249, 115, 22, 0.12)" : OG_COLOR.panel,
      }}
    >
      {label.toUpperCase()}
    </div>
  );
}

/** Card chrome: wordmark and optional badge on top, the caller's body in the middle,
 * `vidit.app` and optional caption at the bottom. */
export function OgCard({
  badge,
  caption,
  children,
}: {
  badge?: React.ReactNode;
  caption?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        padding: "64px",
        background: OG_COLOR.surface,
        color: OG_COLOR.text,
        // Only the 700 cut is bundled; Satori falls back to its default font for other weights,
        // so every node uses 700 and differs by size and colour.
        fontFamily: "Montserrat",
        fontWeight: 700,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <OgWordmark />
        {badge}
      </div>

      <div style={{ display: "flex", flex: 1, minHeight: 0, paddingTop: "40px" }}>{children}</div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          // The body stretches to fill, so the footer needs its own clearance or a bottom-anchored
          // stat row sits flush on it.
          paddingTop: "28px",
          fontSize: "22px",
          color: OG_COLOR.faint,
        }}
      >
        <div style={{ display: "flex" }}>vidit.app</div>
        {caption ? <div style={{ display: "flex" }}>{caption}</div> : null}
      </div>
    </div>
  );
}

/** The site-wide card body (headline and subhead). Renders at `/opengraph-image` and is what
 * a data card falls back to when its upstream read fails, so a transient failure unfurls as
 * the platform, not as a claim about the link. */
export function OgDefaultBody() {
  return (
    <div style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
      {/* Stacked divs for the two lines: satori's flex line-break support is unreliable. */}
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
      {/* Subhead: smaller and neutral so it reads as subordinate despite the shared 700 weight. */}
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
  );
}

/** What a data card answers with when its upstream read failed: the site-wide composition,
 * no claim about the link. The route also emits no title or description on this path, so the
 * whole preview stays neutral. */
export function ogFailedReadResponse(): ImageResponse {
  return ogImageResponse(
    <OgCard>
      <OgDefaultBody />
    </OgCard>,
    { noStore: true },
  );
}

/** Render a card element at the shared size with the bundled font. `noStore` marks the
 * response uncacheable for a card built on a failed read (a second-long condition the image
 * would otherwise outlive); it reaches the `next/og` headers, binding the CDN and honouring
 * crawlers. A crawler with its own caching policy is out of reach, which is why the failure
 * card carries no not-found copy. */
export function ogImageResponse(
  element: React.ReactElement,
  { noStore = false }: { noStore?: boolean } = {},
): ImageResponse {
  return new ImageResponse(element, {
    ...OG_SIZE,
    fonts: [
      {
        name: "Montserrat",
        data: MONTSERRAT_700,
        weight: 700,
        style: "normal",
      },
    ],
    ...(noStore ? { headers: { "cache-control": "no-store, max-age=0" } } : {}),
  });
}
