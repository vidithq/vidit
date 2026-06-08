// Mirror the root og:image so `/about` carries the same card. The
// page-level `openGraph` block in `about/page.tsx` overrides inheritance
// of the root `images` field, so the route needs its own
// `opengraph-image.tsx` to attach the image — Next.js' file-convention
// resolver runs per segment.
export { runtime, size, contentType, alt } from "../opengraph-image";
export { default } from "../opengraph-image";
