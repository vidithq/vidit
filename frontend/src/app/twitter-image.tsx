// Twitter card image — re-uses the Open Graph composition. Same
// dimensions and content; the file convention is what makes Twitter
// (now X) pick it up specifically for the `twitter:image` slot. Kept as
// a re-export so the two stay byte-identical without a shared-module
// indirection.
//
// `runtime` is declared as a literal here (not re-exported) — Next's
// build-time static analyser (`get-page-static-info`) can't resolve a
// re-exported `runtime` to a string and falls back to the route's
// default; making it explicit guarantees `readFileSync` works.
export const runtime = "nodejs";
export { size, contentType, alt } from "./opengraph-image";
export { default } from "./opengraph-image";
