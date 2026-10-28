import { describe, expect, it } from "vitest";

import { BESIDE_GAP_PX, TRIANGLE_RADIUS, besideOffsetPx, triangleSdf } from "./triangle";

const EDGE = 192;

describe("triangleSdf", () => {
  const { width, height, data } = triangleSdf();
  const alpha = (x: number, y: number) => data[(y * width + x) * 4 + 3];
  const insideRow = (y: number) => Array.from({ length: width }, (_, x) => alpha(x, y) >= EDGE).filter(Boolean).length;

  it("is a square image whose centre lies inside the shape and whose corners stay clear", () => {
    expect(width).toBe(height);
    const c = Math.floor(width / 2);
    expect(alpha(c, c)).toBe(255);
    for (const [x, y] of [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]]) {
      expect(alpha(x, y)).toBe(0);
    }
  });

  it("covers the area of a circle of TRIANGLE_RADIUS", () => {
    let inside = 0;
    for (let y = 0; y < height; y++) inside += insideRow(y);
    const circle = Math.PI * TRIANGLE_RADIUS ** 2;
    expect(Math.abs(inside - circle) / circle).toBeLessThan(0.05);
  });

  it("points up: rows widen from the apex to the base", () => {
    const rows = Array.from({ length: height }, (_, y) => insideRow(y)).filter((n) => n > 0);
    expect(rows[0]).toBeLessThan(rows[rows.length - 1]);
    expect(rows).toEqual([...rows].sort((a, b) => a - b));
  });
});

// The edge MapLibre draws: the bilinear alpha of the SDF crossing 192, read in image px from the
// top left corner, as the shader samples it.
describe("the drawn triangle", () => {
  const { width, height, data } = triangleSdf();
  const alpha = (x: number, y: number) => {
    const fx = Math.min(Math.max(x - 0.5, 0), width - 1);
    const fy = Math.min(Math.max(y - 0.5, 0), height - 1);
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(x0 + 1, width - 1);
    const y1 = Math.min(y0 + 1, height - 1);
    const at = (px: number, py: number) => data[(py * width + px) * 4 + 3];
    const tx = fx - x0;
    const ty = fy - y0;
    return (
      at(x0, y0) * (1 - tx) * (1 - ty) + at(x1, y0) * tx * (1 - ty) + at(x0, y1) * (1 - tx) * ty + at(x1, y1) * tx * ty
    );
  };
  // Where the alpha crosses the edge between an outside point and an inside one.
  const crossing = (outside: number, inside: number, at: (t: number) => number) => {
    let [lo, hi] = [outside, inside];
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (at(mid) >= 192) hi = mid;
      else lo = mid;
    }
    return (lo + hi) / 2;
  };
  const c = width / 2;

  it("centres its apex and its base on the image centre", () => {
    const top = crossing(0, c, (y) => alpha(c, y));
    const bottom = crossing(height, c, (y) => alpha(c, y));
    expect(Math.abs((top + bottom) / 2 - c)).toBeLessThan(0.1);
  });

  it.each([12, 16, 20, 26, 34, 42].flatMap((circle) => [12, 20, 42].map((triangle) => [circle, triangle])))(
    "sets a triangle BESIDE_GAP_PX right of a circle of radius %i px, the triangle sized for %i px",
    (circle, triangle) => {
      const scale = triangle / TRIANGLE_RADIUS;
      const offset = besideOffsetPx(circle, triangle);
      const gaps: number[] = [];
      for (let row = 1; row < height - 1; row += 0.25) {
        if (alpha(c, row) < 192) continue;
        const left = crossing(0, c, (x) => alpha(x, row));
        const x = offset + (left - c) * scale;
        const y = (row - c) * scale;
        gaps.push(Math.hypot(x, y) - circle);
      }
      expect(Math.min(...gaps)).toBeGreaterThan(BESIDE_GAP_PX - 0.5);
      expect(Math.min(...gaps)).toBeLessThan(BESIDE_GAP_PX + 0.5);
    },
  );
});
