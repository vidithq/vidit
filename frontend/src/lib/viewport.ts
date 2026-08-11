/**
 * Viewport → `?bbox=` maths for the map's point fetch.
 *
 * `/events/points` requires a bbox, so the map asks for the region it is
 * showing instead of the catalog. These helpers turn a MapLibre viewport
 * into a request box the backend accepts (`services/event_filters.parse_bbox`:
 * `south,west,north,east`, latitudes in [-90, 90], longitudes in
 * [-180, 180], south <= north, west <= east), pad it so a small pan is
 * already covered, and answer whether a new viewport still fits inside the
 * box that was fetched last.
 */

import { LAT_MAX, LAT_MIN, LNG_MAX, LNG_MIN } from "@/lib/coordinates";

/** A geographic rectangle, in the order `parse_bbox` reads it. */
export interface MapBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

/**
 * How far past each edge of the viewport the fetched box reaches, as a
 * fraction of the viewport's own span. 0.25 buys a quarter-screen margin on
 * every side: pans shorter than that reuse the points already in memory,
 * while the payload stays within ~2.25x the visible area.
 */
export const VIEWPORT_PADDING = 0.25;

/**
 * How long the map waits after the last `moveend` before refetching. A drag
 * across several regions, or a wheel zoom that emits a burst of move events,
 * settles into one request instead of one per intermediate viewport.
 */
export const VIEWPORT_DEBOUNCE_MS = 300;

/** Decimal places kept in the `?bbox=` value (~11 m at the equator).
 *  Rounding is outward, so the box only ever grows. */
const BBOX_PRECISION = 4;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Bring a longitude pair into [-180, 180] as a unit.
 *
 * MapLibre reports an unwrapped viewport: panning past the antimeridian
 * yields values like `[-200, -190]`, which the backend rejects. Shifting the
 * pair by whole turns puts most of those back in range. A box that still
 * straddles an edge after the shift genuinely crosses the antimeridian,
 * which the endpoint does not model, so it widens to the full range: over
 * fetching a strip of empty ocean beats dropping half the viewport.
 */
function normalizeLongitudes(west: number, east: number): [number, number] {
  if (!Number.isFinite(west) || !Number.isFinite(east) || east - west >= 360) {
    return [LNG_MIN, LNG_MAX];
  }
  const turns = Math.round((west + east) / 2 / 360);
  const shifted: [number, number] = [west - turns * 360, east - turns * 360];
  if (shifted[0] < LNG_MIN || shifted[1] > LNG_MAX) return [LNG_MIN, LNG_MAX];
  return shifted;
}

/** A raw MapLibre viewport, made safe for `parse_bbox`. */
export function normalizeBounds(bounds: MapBounds): MapBounds {
  const [west, east] = normalizeLongitudes(bounds.west, bounds.east);
  const south = clamp(Math.min(bounds.south, bounds.north), LAT_MIN, LAT_MAX);
  const north = clamp(Math.max(bounds.south, bounds.north), LAT_MIN, LAT_MAX);
  return { south, west, north, east };
}

/** Grow a viewport by `factor` of its own span on every side, clamped to the
 *  valid ranges. The result is what gets fetched; the viewport itself is what
 *  gets tested against it. */
export function padBounds(
  bounds: MapBounds,
  factor: number = VIEWPORT_PADDING
): MapBounds {
  const base = normalizeBounds(bounds);
  const latMargin = (base.north - base.south) * factor;
  const lngMargin = (base.east - base.west) * factor;
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

/** Serialise to the `south,west,north,east` value the endpoint parses.
 *  Each edge rounds outward, so the string never describes a smaller box
 *  than the caller asked for, and two viewports that differ below the
 *  precision floor produce the same value (and so the same server cache
 *  entry). */
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
