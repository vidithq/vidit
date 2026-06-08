// Twitter card image — re-uses the Open Graph composition. Same
// dimensions and content; the file convention is what makes Twitter
// (now X) pick it up specifically for the `twitter:image` slot. Kept as
// a re-export so the two stay byte-identical without a shared-module
// indirection.
export { runtime, size, contentType, alt } from "./opengraph-image";
export { default } from "./opengraph-image";
