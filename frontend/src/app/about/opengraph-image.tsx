// Mirror the root og:image. The page-level `openGraph` block wipes the
// parent's resolved `images` during per-segment metadata resolution, so
// the about segment re-attaches it via Next's file convention.
//
// `runtime` is a literal, not re-exported: Next's static analyser
// (`get-page-static-info`) can't resolve a re-exported `runtime` and
// falls back to the route default, breaking `readFileSync`.
export const runtime = "nodejs";
export { size, contentType, alt } from "../opengraph-image";
export { default } from "../opengraph-image";
