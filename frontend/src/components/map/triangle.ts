/** The triangle image's height at `icon-size` 1. */
export const TRIANGLE_HEIGHT = 48;

/** A triangle's height per diameter of the circle it pairs with. */
const TRIANGLE_HEIGHT_PER_DIAMETER = 1;

// MapLibre reads an SDF icon's alpha as distance: 192 on the edge, 32 steps per pixel, the scale
// its shader assumes for the edge gamma and the halo.
const SDF_EDGE = 0.75;
const SDF_PX = 8;
// Linear sampling of the field blunts the sharp apex by about this many image px, so the shape is
// drawn half of it higher to keep its drawn apex and base centred on the image.
const APEX_BLUNT_PX = 0.9;

/** The shortest distance between a cluster's circle and the triangle beside it. MapLibre's circle
 *  antialiasing reads about half a pixel narrower, so the drawn gap is 1.3 to 2 px. */
export const BESIDE_GAP_PX = 1;

// Montserrat Medium, in ems: a digit's advance, the point's and the k's, and the digits' height.
const DIGIT_EM = 0.66;
const POINT_EM = 0.3;
const K_EM = 0.62;
const DIGIT_HEIGHT_EM = 0.72;
/** The clear space between a count's digits and the triangle's edges. */
const COUNT_MARGIN_PX = 1.5;

type Vec = [number, number];

/** The height of the triangle paired with a circle of `radius` px. */
export function triangleHeight(radius: number): number {
  return 2 * radius * TRIANGLE_HEIGHT_PER_DIAMETER;
}

/** How far below the bounding box centre the incentre sits: the count's place. */
export function incentreDropPx(height: number): number {
  return height / 6;
}

/** The smallest triangle height that holds `label` at `textSize` px around its incentre with
 *  `COUNT_MARGIN_PX` to every edge. */
export function heightToHold(label: string, textSize: number): number {
  const width = [...label].reduce((sum, ch) => sum + (ch === "." ? POINT_EM : ch === "k" ? K_EM : DIGIT_EM), 0);
  const halfWidth = (width * textSize) / 2;
  const halfHeight = (DIGIT_HEIGHT_EM * textSize) / 2;
  // The base sits h/3 below the incentre; a slanted edge is (h - √3·x - y) / 2 from a point at
  // (x, y) measured from the base's midpoint.
  return Math.max(
    3 * (halfHeight + COUNT_MARGIN_PX),
    1.5 * (Math.sqrt(3) * halfWidth + halfHeight + 2 * COUNT_MARGIN_PX),
  );
}

/** The corners of an upward triangle of `height`, its bounding box centred on `[cx, cy]`,
 *  clockwise on screen. */
function corners(height: number, cx: number, cy: number): Vec[] {
  const half = height / Math.sqrt(3);
  return [
    [cx, cy - height / 2],
    [cx + half, cy + height / 2],
    [cx - half, cy + height / 2],
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

/** How far right of the centre of a circle of `circleRadius` px the centre of a triangle of
 *  `height` px sits, on the same line, for the two shapes to be `BESIDE_GAP_PX` apart at their
 *  closest. */
export function besideOffsetPx(circleRadius: number, height: number): number {
  const reach = circleRadius + BESIDE_GAP_PX;
  const closest = (offset: number) =>
    Math.min(...edges(corners(height, offset, 0)).map(([a, b]) => segmentDistance([0, 0], a, b)));
  let low = 0;
  let high = reach + height;
  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2;
    if (closest(mid) < reach) low = mid;
    else high = mid;
  }
  return high;
}

/** An upward triangle `TRIANGLE_HEIGHT` tall, centred on its bounding box, as a signed distance
 *  field for `addImage(id, image, { sdf: true })`, so `icon-color` paints it, `icon-halo-*` rings
 *  it, and the default centre anchor sets its apex and base the same distance above and below the
 *  point. */
export function triangleSdf(): { width: number; height: number; data: Uint8Array } {
  const size = Math.ceil((2 * TRIANGLE_HEIGHT) / Math.sqrt(3) + 2 * SDF_PX);
  const c = size / 2;
  const sides = edges(corners(TRIANGLE_HEIGHT, c, c - APEX_BLUNT_PX / 2));
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
