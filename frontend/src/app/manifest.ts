import type { MetadataRoute } from "next";

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
        src: "/icon/android-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon/android-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      // No `purpose: maskable`: the brand mark is transparent, so the launcher wallpaper would bleed through.
    ],
  };
}
