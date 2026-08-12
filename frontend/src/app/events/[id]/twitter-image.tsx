// `twitter:image` for `/events/{id}`, re-exported from the Open Graph
// composition so the two stay byte-identical. `runtime` is a literal, not
// re-exported: Next's static analyser can't resolve a re-exported `runtime` and
// falls back to the route default, which breaks the font read.
export const runtime = "nodejs";
export { size, contentType, alt } from "./opengraph-image";
export { default } from "./opengraph-image";
