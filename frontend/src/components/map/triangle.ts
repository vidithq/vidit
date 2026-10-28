/** At `icon-size` 1 the triangle covers the area of a circle of this radius, so `radius / 12` sizes
 *  it like a circle marker of that radius. */
export const TRIANGLE_RADIUS = 12;

// MapLibre reads an SDF icon's alpha as distance: 192 on the edge, 32 steps per pixel, the scale
// its shader assumes for the edge gamma and the halo.
const SDF_EDGE = 0.75;
const SDF_PX = 8;

// An equilateral triangle with the area of a circle of radius r has a side of this many r.
const SIDE_PER_RADIUS = Math.sqrt((4 * Math.PI) / Math.sqrt(3));
/** The shortest distance between a cluster's circle and the triangle beside it. MapLibre's circle
 *  antialiasing reads about half a pixel narrower, so the drawn gap is 1.3 to 2 px. */
export const BESIDE_GAP_PX = 1;

type Vec = [number, number];

/** The corners of an upward triangle sized like a circle of `radius`, its bounding box centred on
 *  `[cx, cy]`, clockwise on screen. */
function corners(radius: number, cx: number, cy: number): Vec[] {
  const side = radius * SIDE_PER_RADIUS;
  const height = (side * Math.sqrt(3)) / 2;
  return [
    [cx, cy - height / 2],
    [cx + side / 2, cy + height / 2],
    [cx - side / 2, cy + height / 2],
  ];
}

function edges(points: Vec[]) {
  return points.map((a, i) => [a, points[(i + 1) % points.length]] as const);
}

function segmentDistance([px, py]: Vec, [ax, ay]: Vec, [bx, by]: Vec): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** How far right of the centre of a circle of `circleRadius` px the centre of a triangle sized like
 *  a circle of `triangleRadius` px sits, on the same line, for the two shapes to be
 *  `BESIDE_GAP_PX` apart at their closest. */
export function besideOffsetPx(circleRadius: number, triangleRadius: number): number {
  const reach = circleRadius + BESIDE_GAP_PX;
  const closest = (offset: number) =>
    Math.min(...edges(corners(triangleRadius, offset, 0)).map(([a, b]) => segmentDistance([0, 0], a, b)));
  let low = 0;
  let high = reach + triangleRadius * SIDE_PER_RADIUS;
  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2;
    if (closest(mid) < reach) low = mid;
    else high = mid;
  }
  return high;
}

/** An upward triangle centred on its bounding box, as a signed distance field for `addImage(id,
 *  image, { sdf: true })`, so `icon-color` paints it, `icon-halo-*` rings it, and the default
 *  centre anchor sets its apex and base the same distance above and below the point. */
export function triangleSdf(): { width: number; height: number; data: Uint8Array } {
  const size = Math.ceil(TRIANGLE_RADIUS * SIDE_PER_RADIUS + 2 * SDF_PX);
  const c = size / 2;
  const sides = edges(corners(TRIANGLE_RADIUS, c, c));
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const p: Vec = [x + 0.5, y + 0.5];
      // The corners run clockwise on screen, so a point inside is at a negative distance from every edge.
      const signed = sides.map(([[ax, ay], [bx, by]]) => {
        const len = Math.hypot(bx - ax, by - ay);
        return ((p[0] - ax) * (by - ay) - (p[1] - ay) * (bx - ax)) / len;
      });
      const distance = signed.every((s) => s <= 0)
        ? Math.max(...signed)
        : Math.min(...sides.map(([a, b]) => segmentDistance(p, a, b)));
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.max(0, Math.min(255, Math.round(255 * (SDF_EDGE - distance / SDF_PX))));
    }
  }
  return { width: size, height: size, data };
}
