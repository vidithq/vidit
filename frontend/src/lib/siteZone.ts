import type { MapBounds } from "./viewport";
import type { Zone } from "./sites";

/** A `[lng, lat]` position, the GeoJSON order a zone carries. */
export type Position = [number, number];

const EARTH_RADIUS_M = 6_371_008.8;

/** The corners of a zone's exterior ring, without the closing repeat of the first one. */
export function zoneVertices(zone: Zone): Position[] {
  const ring = zone.coordinates[0] ?? [];
  const open = ring.slice(0, -1);
  return open.map(([lng, lat]) => [lng, lat]);
}

/** A zone from drawn corners: the exterior ring, closed on its first corner. */
export function zoneFromVertices(vertices: Position[]): Zone {
  const ring = [...vertices, vertices[0]].map(([lng, lat]) => [lng, lat] as [number, number]);
  return { type: "Polygon", coordinates: [ring] };
}

/** A polygon needs three corners before it can close. */
export const MIN_ZONE_VERTICES = 3;

/** Mirrors backend `schemas/site.MAX_ZONE_AREA_KM2`; change both. */
export const MAX_ZONE_AREA_KM2 = 1000;

/** An area in square kilometres, thousands grouped: `230,643.89 km²`. */
export function formatAreaKm2(km2: number, decimals = 2): string {
  const digits = { minimumFractionDigits: decimals, maximumFractionDigits: decimals };
  return `${km2.toLocaleString("en-US", digits)} km²`;
}

/** What a site form lacks while no drawn ring makes a zone. */
export const CONTOUR_REQUIREMENT = `A closed contour of at most ${formatAreaKm2(MAX_ZONE_AREA_KM2, 0)} whose edges do not cross or touch`;

// Local equirectangular metres around `origin`: exact enough for a site-sized shape.
function toMetres([lng, lat]: Position, origin: Position): [number, number] {
  const k = (Math.PI / 180) * EARTH_RADIUS_M;
  return [(lng - origin[0]) * k * Math.cos((origin[1] * Math.PI) / 180), (lat - origin[1]) * k];
}

function fromMetres([x, y]: [number, number], origin: Position): Position {
  const k = (Math.PI / 180) * EARTH_RADIUS_M;
  return [origin[0] + x / (k * Math.cos((origin[1] * Math.PI) / 180)), origin[1] + y / k];
}

/** The area enclosed by the corners, in square kilometres. */
export function zoneAreaKm2(vertices: Position[]): number {
  if (vertices.length < MIN_ZONE_VERTICES) return 0;
  const origin = vertices[0];
  const pts = vertices.map((v) => toMetres(v, origin));
  let twice = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    twice += x1 * y2 - x2 * y1;
  }
  return Math.abs(twice) / 2 / 1_000_000;
}

function orientation(a: Position, b: Position, c: Position): number {
  return Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
}

// `p` is collinear with `a`-`b` here; true when it lies within the segment's box.
function onSegment(p: Position, a: Position, b: Position): boolean {
  return (
    Math.min(a[0], b[0]) <= p[0] &&
    p[0] <= Math.max(a[0], b[0]) &&
    Math.min(a[1], b[1]) <= p[1] &&
    p[1] <= Math.max(a[1], b[1])
  );
}

// Any shared point counts: a crossing, an endpoint on the other segment, or a collinear overlap.
function segmentsTouch(p1: Position, p2: Position, q1: Position, q2: Position): boolean {
  const o1 = orientation(p1, p2, q1);
  const o2 = orientation(p1, p2, q2);
  const o3 = orientation(q1, q2, p1);
  const o4 = orientation(q1, q2, p2);
  if (o1 !== o2 && o3 !== o4) return true;
  return (
    (o1 === 0 && onSegment(q1, p1, p2)) ||
    (o2 === 0 && onSegment(q2, p1, p2)) ||
    (o3 === 0 && onSegment(p1, q1, q2)) ||
    (o4 === 0 && onSegment(p2, q1, q2))
  );
}

// The edges `a`-`b` and `b`-`c` overlap past `b`: the ring doubles back on itself.
function foldsBack(a: Position, b: Position, c: Position): boolean {
  if (orientation(a, b, c) !== 0) return false;
  return (a[0] - b[0]) * (c[0] - b[0]) + (a[1] - b[1]) * (c[1] - b[1]) > 0;
}

/** True when the closed ring is not a simple polygon, the shape the API refuses as `invalid_zone`:
 *  two edges that do not follow each other share a point (a crossing, a corner on another edge,
 *  or a collinear overlap), or two that do follow each other fold back. A corner repeated in a row
 *  counts once. Mirrors backend shapely `is_valid` in `services/sites.zone_shape`; change both. */
export function zoneSelfIntersects(vertices: Position[]): boolean {
  const ring = vertices.filter((v, i) => {
    const previous = vertices[(i + vertices.length - 1) % vertices.length];
    return vertices.length === 1 || v[0] !== previous[0] || v[1] !== previous[1];
  });
  const n = ring.length;
  if (n < MIN_ZONE_VERTICES) return vertices.length >= MIN_ZONE_VERTICES;
  for (let i = 0; i < n; i++) {
    if (foldsBack(ring[(i + n - 1) % n], ring[i], ring[(i + 1) % n])) return true;
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsTouch(ring[i], ring[(i + 1) % n], ring[j], ring[(j + 1) % n])) return true;
    }
  }
  return false;
}

/** The point of a zone's exterior ring nearest to `point`, for the dotted line from an event
 *  outside the zone to its edge. */
export function nearestPointOnZone(zone: Zone, point: Position): Position {
  const ring = zone.coordinates[0] ?? [];
  const p = toMetres(point, point);
  let best: [number, number] = toMetres(ring[0] as Position, point);
  let bestDistance = Infinity;
  for (let i = 0; i + 1 < ring.length; i++) {
    const a = toMetres(ring[i] as Position, point);
    const b = toMetres(ring[i + 1] as Position, point);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length2 = dx * dx + dy * dy;
    const t =
      length2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2));
    const candidate: [number, number] = [a[0] + t * dx, a[1] + t * dy];
    const distance = Math.hypot(candidate[0] - p[0], candidate[1] - p[1]);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return fromMetres(best, point);
}

/** The box around every position given, or null for none. */
export function positionsBounds(positions: Position[]): MapBounds | null {
  if (positions.length === 0) return null;
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const [lng, lat] of positions) {
    south = Math.min(south, lat);
    north = Math.max(north, lat);
    west = Math.min(west, lng);
    east = Math.max(east, lng);
  }
  return { south, west, north, east };
}

/** The contour editor's state: the corners, whether the ring is closed, and the corner the
 *  analyst picked (the one **Remove corner** takes). */
export interface DrawState {
  vertices: Position[];
  closed: boolean;
  selected: number | null;
}

export const EMPTY_DRAW: DrawState = { vertices: [], closed: false, selected: null };

/** A closed draw state from a stored zone, so the owner edits the current contour in place. */
export function drawFromZone(zone: Zone): DrawState {
  return { vertices: zoneVertices(zone), closed: true, selected: null };
}

/** Why the API would refuse the ring drawn so far: two edges of the closed ring cross or touch,
 *  or the corners enclose more than `MAX_ZONE_AREA_KM2`, checked before the ring closes. Null
 *  otherwise. */
export function drawRefusal({ vertices, closed }: DrawState): string | null {
  if (closed && zoneSelfIntersects(vertices)) return "Two edges cross or touch. Move a corner.";
  if (zoneAreaKm2(vertices) > MAX_ZONE_AREA_KM2) {
    return `A site covers at most ${formatAreaKm2(MAX_ZONE_AREA_KM2, 0)}. Move the corners closer.`;
  }
  return null;
}

/** True when the drawn ring is closed and `drawRefusal` finds nothing: the zone the API takes. */
export function drawReady(state: DrawState): boolean {
  return state.closed && state.vertices.length >= MIN_ZONE_VERTICES && drawRefusal(state) === null;
}

/** The middle of each edge of the closed ring, where a drag inserts a corner. */
export function edgeMidpoints(vertices: Position[]): Position[] {
  return vertices.map((v, i) => {
    const next = vertices[(i + 1) % vertices.length];
    return [(v[0] + next[0]) / 2, (v[1] + next[1]) / 2];
  });
}

/** A new corner on the edge that starts at corner `edge`, selected. */
export function insertVertex(state: DrawState, edge: number, position: Position): DrawState {
  const vertices = [...state.vertices];
  vertices.splice(edge + 1, 0, position);
  return { ...state, vertices, selected: edge + 1 };
}

export function moveVertex(state: DrawState, index: number, position: Position): DrawState {
  const vertices = state.vertices.slice();
  vertices[index] = position;
  return { ...state, vertices };
}

/** Takes a corner out. A closed ring keeps at least three corners, so the last three stay. */
export function removeVertex(state: DrawState, index: number): DrawState {
  if (state.closed && state.vertices.length <= MIN_ZONE_VERTICES) return state;
  return { ...state, vertices: state.vertices.filter((_, i) => i !== index), selected: null };
}
