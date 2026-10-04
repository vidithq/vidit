import type { Feature } from "geojson";

// Co-located stack helpers. Events sharing near-identical coordinates never uncluster, and past
// the ceiling their circles overlap; Map.tsx recognizes the stack and fans it into the hover ring
// (`SpiderRing`).

/** Clustering stops past this zoom (`clusterMaxZoom` on the points source): supercluster reports
 * an expansion zoom beyond it exactly when a cluster splits only because clustering stops. */
export const CLUSTER_MAX_ZOOM = 14;

/** Coordinate span (degrees) under which points read as one stack: about 1 m. Farther points
 * separate once zoomed past CLUSTER_MAX_ZOOM. Mirrors the `groupStacks` grouping grid. */
export const STACK_EPSILON = 1e-5;

/** Most dots a fan-out ring renders, so a huge stack can't grow an overlay swallowing pointer
 * events; the rest become a "+N" slot. */
export const SPIDER_MAX_DOTS = 24;

/** Grid cell key: integer indices on the STACK_EPSILON grid (not `toFixed`, so -0 never splits a stack). */
export function stackCellKey(lat: number, lng: number): string {
  return `${Math.round(lat / STACK_EPSILON)},${Math.round(lng / STACK_EPSILON)}`;
}

/** Group items into co-located stacks: bucket onto the grid, then union neighbor cells whose
 * members sit within STACK_EPSILON, so a stack straddling a grid line stays one. */
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
    const key = stackCellKey(lat, lng);
    const cell = cells.get(key);
    if (cell) cell.items.push(item);
    else cells.set(key, { latCell, lngCell, items: [item] });
  }

  // Union-find over cells, merging only neighbors that hold a pair within the epsilon.
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
  // Forward half of the 8-neighborhood; the other half is the same pair from the neighbor's side.
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

/** Ring radius (px) for `n` dots: grows only as needed to avoid overlap, capped at the
 * SPIDER_MAX_DOTS slot count. */
export function ringRadius(n: number): number {
  const slots = Math.min(n, SPIDER_MAX_DOTS);
  return Math.max(18, Math.ceil((slots * 16) / (2 * Math.PI)));
}

/** Evenly spaced px offsets around the center, first at the top, clockwise. */
export function ringOffsets(n: number): { dx: number; dy: number }[] {
  const r = ringRadius(n);
  return Array.from({ length: n }, (_, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return { dx: Math.cos(angle) * r, dy: Math.sin(angle) * r };
  });
}

/** Hit slop (px) around a tap on the canvas: pins are 6 to 12px circles, so a tap on bare canvas
 * is re-tested over a box this wide. Coarse pointers only. */
export const TAP_SLOP_PX = 12;

/** The feature a slop-padded tap targets: nearest projected center; non-Point features and ties go
 * to render order (`queryRenderedFeatures` returns topmost first). Pure: the caller passes the projection. */
export function nearestFeature(
  features: readonly Feature[],
  point: { x: number; y: number },
  project: (coordinates: [number, number]) => { x: number; y: number },
): Feature | null {
  const points = features.filter((f) => f.geometry?.type === "Point");
  if (points.length === 0) return null;
  // One candidate in the box wins without projecting.
  if (points.length === 1) return points[0];
  let best: Feature | null = null;
  // Squared distances order like distances; skip the square root.
  let bestSquared = Infinity;
  for (const feature of points) {
    const [lng, lat] = (feature.geometry as GeoJSON.Point).coordinates;
    const { x, y } = project([lng, lat]);
    const squared = (x - point.x) ** 2 + (y - point.y) ** 2;
    if (squared < bestSquared) {
      bestSquared = squared;
      best = feature;
    }
  }
  return best;
}

/** True when the group's Point features (2 or more) all sit within STACK_EPSILON of the first. */
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
