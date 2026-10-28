/** At `icon-size` 1 the triangle covers the area of a circle of this radius, so `radius / 12` sizes
 *  it like a circle marker of that radius. */
export const TRIANGLE_RADIUS = 12;

// MapLibre reads an SDF icon's alpha as distance: 192 on the edge, 32 steps per pixel, the scale
// its shader assumes for the edge gamma and the halo.
const SDF_EDGE = 0.75;
const SDF_PX = 8;

// An equilateral triangle with the area of a circle of radius r has a side of this many r.
const SIDE_PER_RADIUS = Math.sqrt((4 * Math.PI) / Math.sqrt(3));
const GAP_PX = 1;

type Vec = [number, number];

/** How far right of a circle of `circleRadius` px the centroid of a triangle sized like a circle of
 *  `triangleRadius` px sits so the two shapes do not overlap and stay `GAP_PX` apart at their
 *  closest. */
export function besideOffsetPx(circleRadius: number, triangleRadius: number): number {
  const side = triangleRadius * SIDE_PER_RADIUS;
  const height = (side * Math.sqrt(3)) / 2;
  let offset = 0;
  // y runs down from the apex (-2h/3) to the base (h/3), in the centroid's frame.
  for (let i = 0; i <= 200; i++) {
    const y = -(2 * height) / 3 + (height * i) / 200;
    if (Math.abs(y) > circleRadius) continue;
    const triangleLeft = (side / 2) * ((y + (2 * height) / 3) / height);
    offset = Math.max(offset, Math.sqrt(circleRadius ** 2 - y ** 2) + triangleLeft);
  }
  return offset + GAP_PX;
}

function segmentDistance([px, py]: Vec, [ax, ay]: Vec, [bx, by]: Vec): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** An upward triangle centred on its centroid, as a signed distance field for `addImage(id, image,
 *  { sdf: true })`, so `icon-color` paints it and `icon-halo-*` rings it. */
export function triangleSdf(): { width: number; height: number; data: Uint8Array } {
  const side = TRIANGLE_RADIUS * SIDE_PER_RADIUS;
  const height = (side * Math.sqrt(3)) / 2;
  const extent = Math.max((2 * height) / 3, side / 2) + SDF_PX;
  const size = Math.ceil(2 * extent);
  const c = size / 2;
  const corners: Vec[] = [
    [c, c - (2 * height) / 3],
    [c + side / 2, c + height / 3],
    [c - side / 2, c + height / 3],
  ];
  const edges = corners.map((a, i) => [a, corners[(i + 1) % 3]] as const);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const p: Vec = [x + 0.5, y + 0.5];
      // The corners run clockwise on screen, so a point inside is at a negative distance from every edge.
      const sides = edges.map(([[ax, ay], [bx, by]]) => {
        const len = Math.hypot(bx - ax, by - ay);
        return ((p[0] - ax) * (by - ay) - (p[1] - ay) * (bx - ax)) / len;
      });
      const inside = sides.every((s) => s <= 0);
      const distance = inside
        ? Math.max(...sides)
        : Math.min(...edges.map(([a, b]) => segmentDistance(p, a, b)));
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.max(0, Math.min(255, Math.round(255 * (SDF_EDGE - distance / SDF_PX))));
    }
  }
  return { width: size, height: size, data };
}
