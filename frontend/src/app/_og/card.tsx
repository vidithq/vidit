import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ImageResponse } from "next/og";

// The shared Satori frame every `opengraph-image.tsx` in the app renders into:
// one canvas size, one font, one palette, one wordmark, one footer. Satori is a
// known-bespoke surface (see AGENTS.md), so it does not compose the Tailwind
// primitives, but the cards still resolve to a single home rather than one
// hand-built layout per route.
//
// `_og` is a Next private folder: it holds no route of its own.
//
// `runtime = "nodejs"` (not "edge") for the `readFileSync` below, and
// `process.cwd()` for the path; the `outputFileTracingIncludes` rule in
// `next.config.mjs` is what puts the .ttf in the function bundle on Vercel,
// without which every card request 500s with ENOENT.

const MONTSERRAT_700 = readFileSync(
  join(process.cwd(), "src/app/Montserrat-700.ttf"),
);

/** 1200×630, the canonical Open Graph aspect. X and Discord both crop to it. */
export const OG_SIZE = { width: 1200, height: 630 };

export const OG_CONTENT_TYPE = "image/png";

/**
 * Card palette, the hex values behind the Tailwind classes the app uses:
 * `neutral-950` surface, `neutral-900` panel, `neutral-800` border and minor
 * graticule, `neutral-700` major graticule, `orange-500` accent, and
 * `neutral-100` / `neutral-400` / `neutral-500` type. Satori takes no class
 * names, so the scale is restated here as literals; it is the one place the
 * cards read colour from.
 */
export const OG_COLOR = {
  surface: "#0a0a0a",
  panel: "#171717",
  border: "#262626",
  grid: "#262626",
  gridMajor: "#404040",
  accent: "#f97316",
  accentDim: "#7c3d13",
  text: "#f5f5f5",
  muted: "#a3a3a3",
  faint: "#737373",
} as const;

/**
 * The sidebar wordmark: accent `V` plus neutral `idit`. Satori only allows
 * `display: flex | block | none`, so it is a flex row whose two children carry
 * the colour contrast rather than a single styled string.
 */
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

/**
 * Card chrome: the wordmark and an optional badge on top, the caller's body in
 * the middle, `vidit.app` and an optional caption at the bottom.
 */
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
        // Only the 700 cut is bundled; Satori falls back to its default font
        // for any unloaded weight, so every node uses 700 and differentiates by
        // size and colour, not weight.
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
          // The body stretches to fill, so the footer needs its own clearance;
          // without it a bottom-anchored stat row sits flush on the footer.
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

/**
 * The site-wide card body: headline and subhead, no per-route data. It is what
 * `/opengraph-image` renders, and what a data card falls back to when its
 * upstream read fails rather than answers, so a transient failure unfurls as
 * the platform instead of as a claim about the link.
 */
export function OgDefaultBody() {
  return (
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
  );
}

/**
 * What a data card answers with when its upstream read failed rather than
 * answered: the site-wide composition, and no claim about the link.
 *
 * The route also emits no title or description of its own on this path, so the
 * unfurl falls back to the site-wide metadata and the whole preview stays
 * neutral rather than mixing a "not found" headline with a generic image.
 */
export function ogFailedReadResponse(): ImageResponse {
  return ogImageResponse(
    <OgCard>
      <OgDefaultBody />
    </OgCard>,
    { noStore: true },
  );
}

/**
 * Render a card element at the shared size, with the bundled font attached.
 *
 * `noStore` marks the response as one a cache must not keep, which is what a
 * card built on a failed read needs: the failure is a second-long condition and
 * the image outlives it everywhere it is stored. It reaches the response
 * headers `next/og` emits, so it binds the CDN and any crawler that honours it;
 * a crawler that caches by its own policy regardless is not addressable from
 * here, which is the other half of why the failure card carries no not-found
 * copy: whatever it keeps, it keeps a neutral image.
 */
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
