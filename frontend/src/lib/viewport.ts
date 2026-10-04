/**
 * Viewport to `?bbox=` maths for the map's point fetch (`/events/points` requires a bbox).
 *
 * Hand-kept mirror of `services/event_filters.parse_bbox`: field order `south,west,north,east`,
 * latitudes in [-90, 90], longitudes in [-180, 180], south <= north, west <= east. Change the
 * two together.
 */

import { LAT_MAX, LAT_MIN, LNG_MAX, LNG_MIN } from "@/lib/coordinates";

/** A geographic rectangle, in the order `parse_bbox` reads it. */
export interface MapBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** The whole planet, for fetches that want every matching point (the profile's coverage map). */
export const WORLD_BOUNDS: MapBounds = {
  south: LAT_MIN,
  west: LNG_MIN,
  north: LAT_MAX,
  east: LNG_MAX,
};

/** Margin past each viewport edge as a fraction of its span: a quarter-screen, so shorter
 *  pans reuse points in memory (payload stays within ~2.25x the visible area). */
export const VIEWPORT_PADDING = 0.25;

/** Wait after the last `moveend` before refetching, so a burst of move events settles into
 *  one request. */
export const VIEWPORT_DEBOUNCE_MS = 300;

/** Decimal places in the bbox (~11 m at the equator); rounding is outward. */
const BBOX_PRECISION = 4;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Bring a longitude pair into [-180, 180] as a unit. MapLibre reports an unwrapped viewport
 *  (`[-200, -190]` past the antimeridian), which the backend rejects: shift by whole turns. A
 *  box still straddling an edge crosses the antimeridian, which the endpoint doesn't model,
 *  so it widens to the full range (overfetching beats dropping half the viewport).
 *  `west > east` (globe projection) gets the same answer. */
function normalizeLongitudes(west: number, east: number): [number, number] {
  if (
    !Number.isFinite(west) ||
    !Number.isFinite(east) ||
    west > east ||
    east - west >= 360
  ) {
    return [LNG_MIN, LNG_MAX];
  }
  const turns = Math.round((west + east) / 2 / 360);
  const shifted: [number, number] = [west - turns * 360, east - turns * 360];
  if (shifted[0] < LNG_MIN || shifted[1] > LNG_MAX) return [LNG_MIN, LNG_MAX];
  return shifted;
}

/** Bring a latitude pair into [-90, 90], smallest first. `getBounds()` before the map has a
 *  size answers NaN, which would 422 the fetch; the full range is the safe superset. */
function normalizeLatitudes(south: number, north: number): [number, number] {
  if (!Number.isFinite(south) || !Number.isFinite(north)) return [LAT_MIN, LAT_MAX];
  return [
    clamp(Math.min(south, north), LAT_MIN, LAT_MAX),
    clamp(Math.max(south, north), LAT_MIN, LAT_MAX),
  ];
}

/** A raw MapLibre viewport, made safe for `parse_bbox`. */
export function normalizeBounds(bounds: MapBounds): MapBounds {
  const [west, east] = normalizeLongitudes(bounds.west, bounds.east);
  const [south, north] = normalizeLatitudes(bounds.south, bounds.north);
  return { south, west, north, east };
}

/** Grow a viewport by `VIEWPORT_PADDING` of its span on every side, clamped. This is what
 *  gets fetched; the viewport is tested against it. */
export function padBounds(bounds: MapBounds): MapBounds {
  const base = normalizeBounds(bounds);
  const latMargin = (base.north - base.south) * VIEWPORT_PADDING;
  const lngMargin = (base.east - base.west) * VIEWPORT_PADDING;
  return {
    south: clamp(base.south - latMargin, LAT_MIN, LAT_MAX),
    north: clamp(base.north + latMargin, LAT_MIN, LAT_MAX),
    west: clamp(base.west - lngMargin, LNG_MIN, LNG_MAX),
    east: clamp(base.east + lngMargin, LNG_MIN, LNG_MAX),
  };
}

/** True when `inner` lies wholly inside `outer`, so the points already
 *  fetched for `outer` cover it and no request is needed. */
export function boundsContain(outer: MapBounds, inner: MapBounds): boolean {
  const box = normalizeBounds(inner);
  return (
    outer.south <= box.south &&
    outer.north >= box.north &&
    outer.west <= box.west &&
    outer.east >= box.east
  );
}

/** Serialise to `south,west,north,east`. Edges round outward, so the box never shrinks and
 *  viewports differing below the precision floor share one server cache entry. */
export function toBboxParam(bounds: MapBounds): string {
  const scale = 10 ** BBOX_PRECISION;
  const down = (v: number) => Math.floor(v * scale) / scale;
  const up = (v: number) => Math.ceil(v * scale) / scale;
  const box = normalizeBounds(bounds);
  return [
    clamp(down(box.south), LAT_MIN, LAT_MAX),
    clamp(down(box.west), LNG_MIN, LNG_MAX),
    clamp(up(box.north), LAT_MIN, LAT_MAX),
    clamp(up(box.east), LNG_MIN, LNG_MAX),
  ].join(",");
}
