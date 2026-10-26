import type { Feature, FeatureCollection, LineString } from "geojson";

import type { MapBounds } from "@/lib/viewport";

/** Grid intervals in degrees, coarsest first. Each divides 90 and 180 evenly. */
export const GRID_STEPS = [30, 15, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01, 0.005, 0.002, 0.001];

// About this many pixels between two lines. MapLibre tiles are 512 px, so the world is
// 512 * 2^zoom px wide.
const SPACING_PX = 100;
// A wider view (the globe near a pole, where one screen spans every longitude) takes a coarser step.
const MAX_LINES = 120;

export interface GridLine {
  kind: "parallel" | "meridian";
  label: string;
}

/** The finest interval whose lines stand at least `SPACING_PX` apart at `zoom`. */
export function gridStep(zoom: number): number {
  const target = (SPACING_PX * 360) / (512 * 2 ** zoom);
  for (let i = GRID_STEPS.length - 1; i >= 0; i--) {
    if (GRID_STEPS[i] >= target) return GRID_STEPS[i];
  }
  return GRID_STEPS[0];
}

function decimals(step: number): number {
  return Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
}

function multiples(from: number, to: number, step: number, digits: number): number[] {
  const values: number[] = [];
  for (let i = Math.ceil(from / step); i * step <= to; i++) values.push(Number((i * step).toFixed(digits)));
  return values;
}

/** `30°N`, `0.5°W`, `0°` and `180°`: the hemisphere letter after the absolute value. */
export function formatDegrees(value: number, axis: "lat" | "lng", digits: number): string {
  const wrapped = axis === "lng" ? ((((value + 180) % 360) + 360) % 360) - 180 : value;
  const rounded = Number(wrapped.toFixed(digits));
  if (rounded === 0 || (axis === "lng" && Math.abs(rounded) === 180)) return `${Math.abs(rounded)}°`;
  const hemisphere = axis === "lat" ? (rounded > 0 ? "N" : "S") : rounded > 0 ? "E" : "W";
  return `${Math.abs(rounded)}°${hemisphere}`;
}

function line(coordinates: [number, number][], properties: GridLine): Feature<LineString, GridLine> {
  return { type: "Feature", properties, geometry: { type: "LineString", coordinates } };
}

/** A latitude and longitude grid over `bounds` and as much again on each side, so a pan shows
 *  lines before the next update. Each line carries its label and a vertex at every crossing, which
 *  keeps it on the curve of the globe. Longitudes past ±180 (a view across the antimeridian) keep
 *  their unwrapped position and a wrapped label. */
export function graticule(bounds: MapBounds, zoom: number): FeatureCollection<LineString, GridLine> {
  const lngSpan = Math.min(360, bounds.east - bounds.west);
  const latSpan = bounds.north - bounds.south;
  const west = lngSpan >= 180 ? -180 : bounds.west - lngSpan / 2;
  const east = lngSpan >= 180 ? 180 : bounds.east + lngSpan / 2;
  const south = Math.max(-90, bounds.south - latSpan / 2);
  const north = Math.min(90, bounds.north + latSpan / 2);

  let index = GRID_STEPS.indexOf(gridStep(zoom));
  let step = GRID_STEPS[index];
  while (index > 0 && ((east - west) / step > MAX_LINES || (north - south) / step > MAX_LINES)) {
    step = GRID_STEPS[--index];
  }
  const digits = decimals(step);

  const lngs = multiples(west, east, step, digits);
  const lats = multiples(south, north, step, digits).filter((lat) => Math.abs(lat) < 90);
  const lngVertices = [...new Set([west, ...lngs, east])];
  const latVertices = [...new Set([south, ...lats, north])];

  return {
    type: "FeatureCollection",
    features: [
      ...lats.map((lat) =>
        line(
          lngVertices.map((lng) => [lng, lat]),
          { kind: "parallel", label: formatDegrees(lat, "lat", digits) },
        ),
      ),
      ...lngs.map((lng) =>
        line(
          latVertices.map((lat) => [lng, lat]),
          { kind: "meridian", label: formatDegrees(lng, "lng", digits) },
        ),
      ),
    ],
  };
}
