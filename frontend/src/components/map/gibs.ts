import { VectorTile } from "@mapbox/vector-tile";
import type { FeatureCollection, Point } from "geojson";
import type { RasterSourceSpecification } from "maplibre-gl";
import { PbfReader } from "pbf";

export const GIBS_ATTRIBUTION =
  'Imagery: <a href="https://www.earthdata.nasa.gov/gibs" target="_blank">NASA GIBS / EOSDIS</a>';

/** The UTC day before `now`, as GIBS names a day. Today's pass can still be missing from GIBS. */
export function gibsDate(now: Date): string {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  return day.toISOString().slice(0, 10);
}

export const DAILY_IMAGERY_SOURCE = "gibs-true-colour";

// The imagery stops at 9; MapLibre scales the last level past it.
export function dailyImagerySource(date: string): RasterSourceSpecification {
  return {
    type: "raster",
    tiles: [
      `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
    ],
    tileSize: 256,
    maxzoom: 9,
    attribution: GIBS_ATTRIBUTION,
  };
}

// GIBS advertises the fire detections as Web Mercator vector tiles, but serves them only on its
// geographic (EPSG:4326) grid, which a MapLibre vector source cannot read. Its level 0 holds every
// detection of the day in two tiles, read here into GeoJSON from each point's own coordinates.
export function fireDetectionUrls(date: string): string[] {
  return [0, 1].map(
    (column) =>
      `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/VIIRS_SNPP_Thermal_Anomalies_375m_All/default/${date}/500m/0/0/${column}.mvt`,
  );
}

export type FireDetections = FeatureCollection<Point, { frp: number; confidence: string }>;

export function decodeFireDetections(tiles: ArrayBuffer[]): FireDetections {
  const features: FireDetections["features"] = [];
  for (const buffer of tiles) {
    const tile = new VectorTile(new PbfReader(buffer));
    for (const layer of Object.values(tile.layers)) {
      for (let i = 0; i < layer.length; i++) {
        const { LATITUDE, LONGITUDE, FRP, CONFIDENCE } = layer.feature(i).properties;
        if (typeof LATITUDE !== "number" || typeof LONGITUDE !== "number") continue;
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [LONGITUDE, LATITUDE] },
          properties: {
            frp: typeof FRP === "number" ? FRP : 0,
            confidence: typeof CONFIDENCE === "string" ? CONFIDENCE : "",
          },
        });
      }
    }
  }
  return { type: "FeatureCollection", features };
}

const loaded = new Map<string, Promise<FireDetections>>();

/** The day's detections, fetched once per page load: GIBS sends them uncacheable, at about 2 MB. */
export function loadFireDetections(date: string): Promise<FireDetections> {
  let detections = loaded.get(date);
  if (!detections) {
    detections = Promise.all(
      fireDetectionUrls(date).map(async (url) => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`GIBS fire detections: ${response.status}`);
        return response.arrayBuffer();
      }),
    ).then(decodeFireDetections);
    detections.catch(() => loaded.delete(date));
    loaded.set(date, detections);
  }
  return detections;
}
