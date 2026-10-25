import { preconnect } from "react-dom";

// CARTO basemap pair. maplibre paint can't read CSS variables, so tiles swap off the theme here.
export const BASEMAP_STYLE = {
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
} as const;

/** Opens the connection to the style host while the map chunk downloads. maplibre fetches the
 *  style without credentials, hence `anonymous`: a preconnect only serves a request of the same
 *  credentials mode. */
export function preconnectBasemap() {
  preconnect(new URL(BASEMAP_STYLE.dark).origin, { crossOrigin: "anonymous" });
}
