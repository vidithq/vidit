import type { MetadataRoute } from "next";

// PWA / Android home-screen manifest. Next.js's app-router convention
// auto-emits <link rel="manifest" href="/manifest.webmanifest"> in the
// HTML head. The 192 / 512 icons below come from `app/icon.tsx`'s
// generateImageMetadata — same source of truth as the favicon, so the
// brand mark stays in lockstep across surfaces.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Vidit",
    short_name: "Vidit",
    description:
      "Archive and visualize geolocations of conflict-related events worldwide.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    icons: [
      {
        src: "/icon/android-192",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon/android-512",
        sizes: "512x512",
        type: "image/png",
      },
      // No `purpose: maskable` variant — maskable expects a solid
      // safe-zone background, and the brand mark ships transparent. A
      // maskable PNG on a transparent canvas would let the launcher
      // wallpaper bleed through and look broken on light home screens.
      // If we add a tile-backgrounded variant later, layer it as a
      // separate entry instead of reusing this one.
    ],
  };
}
