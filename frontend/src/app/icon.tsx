import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ImageResponse } from "next/og";

// Read once at module load, not per request. The TTF lives next to
// this file inside `src/app/`. The `process.cwd()` path resolves at
// runtime, so Vercel's node-file-trace can't discover it
// statically — without the explicit `outputFileTracingIncludes`
// entry in `next.config.mjs`, the .ttf is missing on Vercel and
// every `/icon/*` request 500s with `ENOENT: ... Montserrat-700.ttf`
// (which then cascades into a Server Components render error on any
// page that pulls the manifest).
//
// We don't use `readFileSync(new URL("./Montserrat-700.ttf", import.meta.url))`
// either — webpack rewrites `import.meta.url` for the server bundle
// to something `readFileSync` can't accept ("Received an instance of
// URL" at build time). Explicit tracing config + `process.cwd()` is
// the path Vercel and the Next.js docs endorse.
const MONTSERRAT_700 = readFileSync(
  join(process.cwd(), "src/app/Montserrat-700.ttf"),
);

// Auto-generated icons via Satori. Next.js's app-router file convention
// turns this file into:
//   - <link rel="icon" type="image/png" sizes="32x32" href="/icon/...">    (browsers)
//   - icons referenced by the web app manifest (192 / 512 for Android home-screen)
//
// We render a literal "V" in Montserrat-700 — the same font + weight
// used for the sidebar mark — so the favicon and the sidebar V come
// from one source of truth. Earlier iterations of this file hand-drew
// the V as an SVG path and never quite matched the sidebar geometry,
// because no path approximation lands on the exact Montserrat-Bold
// glyph. Bundling the font fixes that.

export const dynamic = "force-static";
export const runtime = "nodejs";

export function generateImageMetadata() {
  return [
    { id: "favicon", contentType: "image/png", size: { width: 32, height: 32 } },
    { id: "android-192", contentType: "image/png", size: { width: 192, height: 192 } },
    { id: "android-512", contentType: "image/png", size: { width: 512, height: 512 } },
  ];
}

export default function Icon({ id }: { id: string }) {
  const size =
    id === "android-512" ? 512 : id === "android-192" ? 192 : 32;

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          // Transparent — the V reads on light and dark browser chrome,
          // iOS rounded-corner mask, and Android adaptive icon.
          background: "transparent",
          alignItems: "center",
          justifyContent: "center",
          color: "#f97316",
          fontFamily: "Montserrat",
          fontWeight: 700,
          // 90% of the canvas height. Montserrat-700 has natural side-
          // bearing so the glyph still has a bit of breathing room
          // around it at this size.
          fontSize: `${size * 0.9}px`,
          lineHeight: 1,
          // Nudge down ~18% of canvas. The visual centre of a "V"
          // sits higher than its geometric centre (the glyph tapers
          // to a point at the bottom, so the optical weight is in
          // the top half); flex-centring then makes the icon read as
          // top-heavy in browser tabs. Pushing it down lines the V
          // up with the baseline of adjacent tab text.
          paddingTop: `${size * 0.18}px`,
        }}
      >
        V
      </div>
    ),
    {
      width: size,
      height: size,
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
