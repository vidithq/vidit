// Mirrors the root og:image: page-level `openGraph` wipes the parent's `images`, so the segment re-attaches it.
// `runtime` is a literal: Next's static analyser cannot resolve a re-exported one, breaking `readFileSync`.
export const runtime = "nodejs";
export { size, contentType, alt } from "../opengraph-image";
export { default } from "../opengraph-image";
