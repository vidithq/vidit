// `twitter:image`, re-exported from the Open Graph composition so the two stay identical.
// `runtime` is a literal: Next's static analyser cannot resolve a re-exported one.
export const runtime = "nodejs";
export { size, contentType, alt } from "./opengraph-image";
export { default } from "./opengraph-image";
