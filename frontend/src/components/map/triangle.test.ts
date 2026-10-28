import { describe, expect, it } from "vitest";

import { siteTriangleHeight } from "./layers";
import { BESIDE_GAP_PX, TRIANGLE_HEIGHT, besideOffsetPx, heightToHold, triangleHeight, triangleSdf } from "./triangle";

const EDGE = 192;

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
      if (at(mid) >= EDGE) hi = mid;
      else lo = mid;
    }
    return (lo + hi) / 2;
  };
  const c = width / 2;
  const top = crossing(0, c, (y) => alpha(c, y));
  const bottom = crossing(height, c, (y) => alpha(c, y));

  it("is a square image whose corners stay clear", () => {
    expect(width).toBe(height);
    for (const [x, y] of [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]]) {
      expect(data[(y * width + x) * 4 + 3]).toBe(0);
    }
  });

  // Sampling rounds the sharp apex by about a pixel.
  it("is TRIANGLE_HEIGHT tall, its apex and its base centred on the image", () => {
    expect(bottom - top).toBeGreaterThan(TRIANGLE_HEIGHT - 1.5);
    expect(bottom - top).toBeLessThan(TRIANGLE_HEIGHT + 0.25);
    expect(Math.abs((top + bottom) / 2 - c)).toBeLessThan(0.1);
  });

  it("points up: rows widen from the apex to the base", () => {
    const widths = Array.from({ length: 20 }, (_, i) => {
      const y = top + 1 + ((bottom - top - 2) * i) / 19;
      return crossing(width, c, (x) => alpha(x, y)) - crossing(0, c, (x) => alpha(x, y));
    });
    expect(widths).toEqual([...widths].sort((a, b) => a - b));
  });

  it.each([6, 12, 16, 20, 26, 34, 42].flatMap((circle) => [16, 24, 48, 84].map((h) => [circle, h])))(
    "sets a triangle BESIDE_GAP_PX right of a circle of radius %i px, the triangle %i px tall",
    (circle, triangle) => {
      const scale = triangle / TRIANGLE_HEIGHT;
      const offset = besideOffsetPx(circle, triangle);
      const gaps: number[] = [];
      for (let row = top + 0.25; row < bottom; row += 0.25) {
        const left = crossing(0, c, (x) => alpha(x, row));
        gaps.push(Math.hypot(offset + (left - c) * scale, (row - c) * scale) - circle);
      }
      expect(Math.min(...gaps)).toBeGreaterThan(BESIDE_GAP_PX - 0.5);
      expect(Math.min(...gaps)).toBeLessThan(BESIDE_GAP_PX + 0.5);
    },
  );
});

describe("siteTriangleHeight", () => {
  it.each([
    [1, "1", 11],
    [9, "9", 11],
    [14, "14", 11],
    [49, "49", 11],
    [99, "99", 11],
    [287, "287", 11],
    [999, "999", 11],
    [1500, "1.5k", 13],
    [9900, "9.9k", 13],
    [99000, "99k", 15],
    [999000, "999k", 15],
  ])("holds the count of %i sites, %s, around the incentre", (count, label, size) => {
    expect(siteTriangleHeight(count)).toBeGreaterThanOrEqual(heightToHold(label as string, size as number));
  });

  it("pairs a short count with the triangle of its own circle", () => {
    expect(siteTriangleHeight(3)).toBe(Math.max(triangleHeight(12), siteTriangleHeight(3)));
    expect(siteTriangleHeight(3)).toBeLessThanOrEqual(siteTriangleHeight(14));
  });

  it("never shrinks as the count grows", () => {
    const heights = [1, 10, 50, 100, 200, 1000, 5000, 10000].map(siteTriangleHeight);
    expect(heights).toEqual([...heights].sort((a, b) => a - b));
  });
});
