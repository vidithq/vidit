import type { MapPoint } from "@/types";

/** A geographic box as MapLibre reads it: `[west, south, east, north]`. */
export type Bounds = [number, number, number, number];

/**
 * The whole planet as `/events/points` spells a bbox: `south,west,north,east`
 * (`services/event_filters.parse_bbox`). A fetch that wants every matching
 * point, not a viewport slice, passes this explicitly rather than omitting the
 * parameter, so the call keeps its meaning whether or not the endpoint requires
 * a box.
 */
export const WORLD_BBOX = "-90,-180,90,180";

/**
 * The box enclosing `points`, or null when there is nothing to enclose.
 *
 * Degenerate boxes are returned as-is (one point, or several sharing a
 * coordinate): the camera clamps them through `fitBounds`' own `maxZoom`, so
 * the padding decision stays in one place instead of being smeared over a
 * synthetic margin here.
 */
export function pointsBounds(points: MapPoint[]): Bounds | null {
  if (points.length === 0) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [, lat, lng] of points) {
    // A NaN coordinate would poison every comparison and hand MapLibre an
    // uncomputable camera; skip it rather than fail the whole fit.
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  if (west === Infinity) return null;
  return [west, south, east, north];
}
