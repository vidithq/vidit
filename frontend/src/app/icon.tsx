import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ImageResponse } from "next/og";

// Read once at module load. The `process.cwd()` path resolves at runtime,
// so node-file-trace can't discover the .ttf statically — without the
// `outputFileTracingIncludes` entry in `next.config.mjs` it's missing on
// Vercel and every `/icon/*` request 500s with ENOENT, cascading into a
// Server Components render error on any page that pulls the manifest.
//
// `readFileSync(new URL("...", import.meta.url))` doesn't work either:
// webpack rewrites `import.meta.url` for the server bundle to something
// readFileSync rejects ("Received an instance of URL"). Explicit tracing
// config + `process.cwd()` is the Vercel/Next-endorsed path.
const MONTSERRAT_700 = readFileSync(
  join(process.cwd(), "src/app/Montserrat-700.ttf"),
);

// Auto-generated icons via Satori: browser favicon (32x32) + manifest
// icons (192/512 for Android home-screen).
//
// Renders a literal "V" in Montserrat-700 so the favicon and sidebar V
// share one source of truth.

export const dynamic = "force-static";
export const runtime = "nodejs";

export function generateImageMetadata() {
  return [
    { id: "favicon", contentType: "image/png", size: { width: 32, height: 32 } },
    { id: "android-192", contentType: "image/png", size: { width: 192, height: 192 } },
    { id: "android-512", contentType: "image/png", size: { width: 512, height: 512 } },
  ];
}

// Next hands `id` to the handler as a Promise (the route template passes
// `ctx.params.then(p => p.__metadata_id__)`), so the handler is async and
// awaits it. A sync `id === "android-512"` compares a Promise to a string,
// never matches, and every variant ships 32px while the `<link sizes>`
// claims 192 / 512: Google's favicon crawler drops icons under 48px, so
// search results keep the generic globe. `/favicon.ico` calls this with a
// plain string, hence the union.
export default async function Icon({ id }: { id: string | Promise<string> }) {
  const resolved = await id;
  const size =
    resolved === "android-512" ? 512 : resolved === "android-192" ? 192 : 32;

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          // Transparent so the V reads on light/dark chrome, the iOS
          // rounded-corner mask, and Android adaptive icons.
          background: "transparent",
          alignItems: "center",
          justifyContent: "center",
          color: "#f97316",
          fontFamily: "Montserrat",
          fontWeight: 700,
          // 90% of canvas height; Montserrat-700's side-bearing keeps
          // breathing room around the glyph.
          fontSize: `${size * 0.9}px`,
          lineHeight: 1,
          // A "V"'s optical centre sits above its geometric centre (it
          // tapers to a point), so flex-centring reads top-heavy in tabs.
          // Nudging down ~18% aligns it with adjacent tab text.
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
