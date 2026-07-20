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
 *  interaction for them. Mirrors the `groupStacks` grouping grid. */
export const STACK_EPSILON = 1e-5;

/** The most dots a fan-out ring renders. A pathological stack (hundreds of
 *  events on one coordinate) would otherwise grow the ring into an overlay
 *  swallowing wheel and pointer over a large map area; past the cap the ring
 *  shows the first `SPIDER_MAX_DOTS - 1` events plus a "+N" overflow slot. */
export const SPIDER_MAX_DOTS = 24;

/** Grid cell key for grouping co-located points: integer indices on the
 *  STACK_EPSILON grid. Integer indices (not `toFixed`) so the origin never
 *  splits a stack: -0 stringifies as "0", where "-0.00000" !== "0.00000". */
export function stackCellKey(lat: number, lng: number): string {
  return `${Math.round(lat / STACK_EPSILON)},${Math.round(lng / STACK_EPSILON)}`;
}

/** Group items into co-located stacks: bucket onto the STACK_EPSILON grid,
 *  then union neighbor cells whose members sit within STACK_EPSILON of each
 *  other, so a stack straddling a grid line still reads as one (two points
 *  within the epsilon can never land more than one cell apart). */
export function groupStacks<T>(
  items: readonly T[],
  coord: (item: T) => { lat: number; lng: number }
): T[][] {
  const cells = new Map<
    string,
    { latCell: number; lngCell: number; items: T[] }
  >();
  for (const item of items) {
    const { lat, lng } = coord(item);
    const latCell = Math.round(lat / STACK_EPSILON);
    const lngCell = Math.round(lng / STACK_EPSILON);
    const key = `${latCell},${lngCell}`;
    const cell = cells.get(key);
    if (cell) cell.items.push(item);
    else cells.set(key, { latCell, lngCell, items: [item] });
  }

  // Union-find over cells, merging only neighbor cells that actually hold a
  // pair within the epsilon (adjacency alone is not co-location).
  const parent = new Map<string, string>();
  for (const key of cells.keys()) parent.set(key, key);
  const find = (key: string): string => {
    let root = key;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(key, root);
    return root;
  };
  const near = (a: readonly T[], b: readonly T[]): boolean =>
    a.some((x) => {
      const ca = coord(x);
      return b.some((y) => {
        const cb = coord(y);
        return (
          Math.abs(ca.lat - cb.lat) <= STACK_EPSILON &&
          Math.abs(ca.lng - cb.lng) <= STACK_EPSILON
        );
      });
    });
  // Forward half of the 8-neighborhood; the other half is the same pair
  // visited from the neighbor's side.
  const forward = [
    [0, 1],
    [1, -1],
    [1, 0],
    [1, 1],
  ] as const;
  for (const [key, cell] of cells) {
    for (const [dLat, dLng] of forward) {
      const neighborKey = `${cell.latCell + dLat},${cell.lngCell + dLng}`;
      const neighbor = cells.get(neighborKey);
      if (!neighbor || !near(cell.items, neighbor.items)) continue;
      const rootA = find(key);
      const rootB = find(neighborKey);
      if (rootA !== rootB) parent.set(rootA, rootB);
    }
  }

  const groups = new Map<string, T[]>();
  for (const [key, cell] of cells) {
    const root = find(key);
    const group = groups.get(root);
    if (group) group.push(...cell.items);
    else groups.set(root, [...cell.items]);
  }
  return [...groups.values()];
}

/** Ring radius (px) for `n` fanned-out circles: small and subtle, growing
 *  only as far as needed so the dots never overlap on the circumference,
 *  and capped at the SPIDER_MAX_DOTS slot count (larger stacks overflow
 *  into the "+N" slot instead of growing the ring). */
export function ringRadius(n: number): number {
  const slots = Math.min(n, SPIDER_MAX_DOTS);
  return Math.max(18, Math.ceil((slots * 16) / (2 * Math.PI)));
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
