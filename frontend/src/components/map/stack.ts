import type { Feature } from "geojson";

// Co-located stack helpers for the map. Several events can carry the same
// (or near-identical) coordinates: repeated strikes on one site, re-imported
// posts. Their cluster never expands (identical points cannot uncluster at
// any zoom) and, once past the clustering ceiling, their circles render on
// top of each other. Map.tsx uses these helpers to recognize such a stack
// and fan it out into the hover ring (see `SpiderRing` there).

/** Clustering stops past this zoom (`clusterMaxZoom` on the points source).
 *  Supercluster reports an expansion zoom beyond it exactly when a cluster
 *  splits only because clustering stops, not because its points separate. */
export const CLUSTER_MAX_ZOOM = 14;

/** Coordinate span (in degrees) under which points read as one stack: about
 *  1 m, identical coordinates plus GPS-precision noise. Points farther apart
 *  separate visually once zoomed past CLUSTER_MAX_ZOOM, so zooming stays the
 *  interaction for them. Mirrors the `stackCellKey` grouping grid. */
export const STACK_EPSILON = 1e-5;

/** Grid cell for grouping co-located points (the unclustered stack badge):
 *  5 decimals of a degree, the same ~1 m tolerance as STACK_EPSILON. */
export function stackCellKey(lat: number, lng: number): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

/** Ring radius (px) for `n` fanned-out circles: small and subtle, growing
 *  only as far as needed so the dots never overlap on the circumference. */
export function ringRadius(n: number): number {
  return Math.max(18, Math.ceil((n * 16) / (2 * Math.PI)));
}

/** Evenly spaced px offsets around the shared center for `n` fanned-out
 *  circles, first at the top, clockwise. */
export function ringOffsets(n: number): { dx: number; dy: number }[] {
  const r = ringRadius(n);
  return Array.from({ length: n }, (_, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return { dx: Math.cos(angle) * r, dy: Math.sin(angle) * r };
  });
}

/** True when the group's Point features (2 or more) all sit within
 *  STACK_EPSILON of the first: no zoom level can separate them. */
export function isCoincidentStack(features: ReadonlyArray<Feature>): boolean {
  const coords = features
    .filter((f) => f.geometry?.type === "Point")
    .map((f) => (f.geometry as GeoJSON.Point).coordinates);
  if (coords.length < 2) return false;
  const [lng0, lat0] = coords[0];
  return coords.every(
    ([lng, lat]) =>
      Math.abs(lng - lng0) <= STACK_EPSILON &&
      Math.abs(lat - lat0) <= STACK_EPSILON,
  );
}
