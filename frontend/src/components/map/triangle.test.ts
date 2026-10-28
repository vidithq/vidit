import { describe, expect, it } from "vitest";

import { TRIANGLE_RADIUS, besideOffsetPx, triangleSdf } from "./triangle";

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

describe("besideOffsetPx", () => {
  // The left edge of a triangle with the area of a circle of `radius`, centroid at the origin.
  function leftEdge(radius: number): [number, number][] {
    const side = radius * Math.sqrt((4 * Math.PI) / Math.sqrt(3));
    const height = (side * Math.sqrt(3)) / 2;
    return Array.from({ length: 101 }, (_, i) => {
      const t = i / 100;
      return [(-side / 2) * t, -(2 * height) / 3 + height * t];
    });
  }

  it.each([
    [12, 12],
    [12, 42],
    [42, 12],
    [26, 16],
  ])("sets a triangle of radius %i beside a circle of radius %i, apart but nearly touching", (circle, triangle) => {
    const offset = besideOffsetPx(circle, triangle);
    const gaps = leftEdge(triangle).map(([x, y]) => Math.hypot(x + offset, y) - circle);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(0);
    expect(Math.min(...gaps)).toBeLessThan(2);
  });
});
