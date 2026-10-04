import type { MapPoint } from "@/types";
import type { MapBounds } from "@/lib/viewport";

/** Whether a point carries a usable coordinate pair. A NaN or infinite coordinate poisons
 * comparisons and the camera; one home so callers count what `pointsBounds` enclosed. */
export function hasFiniteCoords([, lat, lng]: MapPoint): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng);
}

/**
 * The box enclosing `points`, or null for none. A framing box for `<Map fitBounds>`; to fetch it,
 * run it through `toBboxParam`, which owns the `?bbox=` wire format.
 *
 * Degenerate boxes (one point, shared coordinates) are returned as-is: `fitBounds`' own `maxZoom`
 * clamps them.
 *
 * Longitude is enclosed on the **shorter arc**, not plain min/max: points either side of the
 * antimeridian (Chukotka and Alaska, Fiji) would otherwise frame as a world view. The box is the
 * complement of the widest empty gap between consecutive longitudes. A crossing box comes back
 * unwrapped with `east` past 180 (`{ west: 179, east: 181 }`), as MapLibre reads it. `parse_bbox`
 * models no such box (`west <= east`, both in [-180, 180]), so serialising one widens it to the
 * full longitude range: the request over-fetches the latitude band.
 *
 * Ties go to the plain box (evenly spread points have no tight framing).
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
  // Start from the gap wrapping through the antimeridian; a wider inner gap means the points
  // cluster across the seam.
  let widestGap = lngs[0] + 360 - lngs[lngs.length - 1];
  let westIndex = 0;
  for (let i = 1; i < lngs.length; i++) {
    const gap = lngs[i] - lngs[i - 1];
    if (gap > widestGap) {
      widestGap = gap;
      westIndex = i;
    }
  }
  // The box runs east from just after the widest gap to just before it, +360 when it crosses the seam.
  const west = lngs[westIndex];
  const east = westIndex === 0 ? lngs[lngs.length - 1] : lngs[westIndex - 1] + 360;

  return { south, west, north, east };
}
