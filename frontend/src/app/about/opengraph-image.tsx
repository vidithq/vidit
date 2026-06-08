// Mirror the root og:image so `/about` carries the same card. Defining
// an `openGraph` block at the page level wipes the parent's resolved
// `images` field during per-segment metadata resolution, so the about
// segment needs its own `opengraph-image.tsx` to re-attach the image
// via Next.js' file convention.
//
// `runtime` is declared as a literal here (not re-exported) — Next's
// build-time static analyser (`get-page-static-info`) can't resolve a
// re-exported `runtime` to a string and falls back to the route's
// default; making it explicit guarantees `readFileSync` works.
export const runtime = "nodejs";
export { size, contentType, alt } from "../opengraph-image";
export { default } from "../opengraph-image";
