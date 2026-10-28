/** The public page of each provider the basemaps, layers and overlays draw from, linked from
 *  their `?` in the basemap control (`FIELD_HELP`). Kept apart from `basemap.ts`, so the help
 *  registry and `KNOWN_HOSTS` read it without loading the styles. */
export const MAP_SOURCES = {
  openFreeMap: { name: "OpenFreeMap", href: "https://openfreemap.org/" },
  openStreetMap: { name: "OpenStreetMap", href: "https://www.openstreetmap.org/copyright" },
  openMapTiles: { name: "OpenMapTiles", href: "https://openmaptiles.org/docs/schema/" },
  naturalEarth: {
    name: "Natural Earth",
    href: "https://www.naturalearthdata.com/downloads/10m-raster-data/10m-natural-earth-2/",
  },
  openTopoMap: { name: "OpenTopoMap", href: "https://opentopomap.org/about" },
  sentinel2Cloudless: { name: "EOX Sentinel-2 cloudless", href: "https://cloudless.eox.at/" },
  terrainTiles: { name: "Terrain Tiles", href: "https://registry.opendata.aws/terrain-tiles/" },
  nasaGibs: {
    name: "NASA GIBS",
    href: "https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api",
  },
  nasaFirms: { name: "NASA FIRMS", href: "https://www.earthdata.nasa.gov/data/tools/firms" },
} as const satisfies Record<string, { name: string; href: string }>;
