// Regenerates the world outline behind the share card's locator panel
// (`src/app/_og/landmass.ts`). One-off: run it only to rebuild that constant.
//
//   curl -sSL -o /tmp/ne_110m_land.geojson \
//     https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson
//   node scripts/build-og-landmass.mjs /tmp/ne_110m_land.geojson
//
// Input is Natural Earth 110m land (public domain). It is not committed: the
// card ships the generated path only, so rendering a card fetches nothing.
//
// The output is plate-carrée path data in a 360x180 user space (x = lng + 180,
// y = 90 - lat), the same frame the graticule and the marker are placed in, so
// the panel can scale it to any size without touching the projection.
import { readFileSync } from "node:fs";

/** Rings whose bounding box is smaller than this (deg²) are dropped. */
const MIN_RING_BOX = 12;
/** Douglas-Peucker tolerance, in degrees. */
const TOLERANCE = 1.1;
/** Emitted coordinate precision, in decimal places. */
const PRECISION = 1;

/** Perpendicular distance from `p` to the segment `a`-`b`, squared. */
function segmentDistanceSq(p, a, b) {
  let [x, y] = a;
  const dx = b[0] - x;
  const dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      [x, y] = b;
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  return (p[0] - x) ** 2 + (p[1] - y) ** 2;
}

/** Douglas-Peucker simplification of an open point list. */
function simplify(points, tolerance) {
  if (points.length < 3) return points;
  const toleranceSq = tolerance * tolerance;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop();
    let index = -1;
    let worst = toleranceSq;
    for (let i = first + 1; i < last; i += 1) {
      const distance = segmentDistanceSq(points[i], points[first], points[last]);
      if (distance > worst) {
        worst = distance;
        index = i;
      }
    }
    if (index !== -1) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

/** Bounding-box area of a ring, in square degrees. */
function ringBox(ring) {
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
}

/** Every ring of a Polygon or MultiPolygon geometry. */
function geometryRings(geometry) {
  if (geometry.type === "Polygon") return geometry.coordinates;
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flat();
  return [];
}

const source = process.argv[2];
if (!source) {
  console.error("usage: node scripts/build-og-landmass.mjs <ne_110m_land.geojson>");
  process.exit(1);
}

const collection = JSON.parse(readFileSync(source, "utf8"));
const commands = [];
let rings = 0;

for (const feature of collection.features) {
  for (const ring of geometryRings(feature.geometry)) {
    // Antarctica: a band along the bottom edge that carries no locating signal
    // at card size and costs a long ring to draw.
    if (ring.every(([, lat]) => lat < -55)) continue;
    if (ringBox(ring) < MIN_RING_BOX) continue;

    const projected = ring.map(([lng, lat]) => [lng + 180, 90 - lat]);
    const simplified = simplify(projected, TOLERANCE);
    const rounded = simplified.map((p) => p.map((v) => Number(v.toFixed(PRECISION))));
    // Rounding can collapse neighbours onto one another.
    const deduped = rounded.filter(
      (p, i) => i === 0 || p[0] !== rounded[i - 1][0] || p[1] !== rounded[i - 1][1],
    );
    if (deduped.length < 4) continue;

    rings += 1;
    const [start, ...rest] = deduped;
    commands.push(`M${start[0]} ${start[1]}`, ...rest.map((p) => `L${p[0]} ${p[1]}`), "Z");
  }
}

const path = commands.join("");
process.stderr.write(`${rings} rings, ${path.length} chars\n`);
process.stdout.write(path);
