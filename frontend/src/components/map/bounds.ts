import type { MapPoint } from "@/types";
import type { MapBounds } from "@/lib/viewport";

/**
 * Whether a point carries a usable coordinate pair.
 *
 * A NaN or infinite coordinate poisons every comparison and hands MapLibre an
 * uncomputable camera. The one home for that predicate, so a caller counting
 * what it maps counts exactly what `pointsBounds` enclosed.
 */
export function hasFiniteCoords([, lat, lng]: MapPoint): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng);
}

/**
 * The box enclosing `points`, or null when there is nothing to enclose.
 *
 * A framing box, not a request box: it feeds `<Map fitBounds>`. `MapBounds` is
 * the one bounds shape in the frontend, so a caller that also wants to fetch
 * it runs it through `toBboxParam`, which owns the `?bbox=` wire format.
 *
 * Degenerate boxes are returned as-is (one point, or several sharing a
 * coordinate): the camera clamps them through `fitBounds`' own `maxZoom`, so
 * the padding decision stays in one place instead of being smeared over a
 * synthetic margin here.
 *
 * Longitude is enclosed on the **shorter arc**, not by a plain min/max. An
 * analyst working either side of the antimeridian (Chukotka and Alaska, Fiji)
 * has points near -180 and near +180, whose min/max box spans nearly the whole
 * planet and frames their work as a world view. Instead the widest empty gap
 * between consecutive longitudes is found and the box is its complement: the
 * tightest arc that still holds every point. When that gap is the one already
 * straddling the antimeridian, the result is the plain min/max box, so the
 * ordinary case is unchanged. A crossing box comes back unwrapped, with `east`
 * past 180 (`{ west: 179, east: 181 }`), which is how MapLibre reads a box
 * across the seam. `parse_bbox` models no such box (`west <= east`, both in
 * [-180, 180]), so serialising one widens it to the full longitude range:
 * framing keeps the tight arc, the request over-fetches the latitude band.
 *
 * Ties go to the plain box. A set with no dominant gap (points spread evenly
 * around the globe) has no tight framing to find, and either answer is a world
 * view.
 */
export function pointsBounds(points: MapPoint[]): MapBounds | null {
  const usable = points.filter(hasFiniteCoords);
  if (usable.length === 0) return null;

  let south = Infinity;
  let north = -Infinity;
  for (const [, lat] of usable) {
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }

  const lngs = usable.map(([, , lng]) => lng).sort((a, b) => a - b);
  // Start from the gap that wraps through the antimeridian (last point east to
  // first point, the long way round). Any inner gap wider than it means the
  // points cluster across the seam rather than across the prime meridian.
  let widestGap = lngs[0] + 360 - lngs[lngs.length - 1];
  let westIndex = 0;
  for (let i = 1; i < lngs.length; i++) {
    const gap = lngs[i] - lngs[i - 1];
    if (gap > widestGap) {
      widestGap = gap;
      westIndex = i;
    }
  }
  // The box runs eastward from the point just after the widest gap to the one
  // just before it, +360 when that walk crosses the seam.
  const west = lngs[westIndex];
  const east = westIndex === 0 ? lngs[lngs.length - 1] : lngs[westIndex - 1] + 360;

  return { south, west, north, east };
}
