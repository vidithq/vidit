import type { MetadataRoute } from "next";

// PWA / Android home-screen manifest. The 192 / 512 icons come from
// `app/icon.tsx`'s generateImageMetadata — same source of truth as the
// favicon, so the brand mark stays in lockstep across surfaces.
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
      // No `purpose: maskable` variant: maskable expects a solid safe-zone
      // background, but the brand mark ships transparent, so the launcher
      // wallpaper would bleed through and look broken on light home screens.
    ],
  };
}
