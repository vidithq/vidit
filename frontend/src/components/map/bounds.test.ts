import { describe, expect, it } from "vitest";
import type { MapPoint } from "@/types";

import { WORLD_BBOX, hasFiniteCoords, pointsBounds } from "./bounds";

function point(lat: number, lng: number): MapPoint {
  return ["id", lat, lng, null, "2026-01-01", 0, 0];
}

const BROKEN = ["id", Number.NaN, Number.NaN, null, "2026-01-01", 0, 0] as MapPoint;

describe("pointsBounds", () => {
  it("returns null for an empty set", () => {
    expect(pointsBounds([])).toBeNull();
  });

  it("encloses every point", () => {
    expect(
      pointsBounds([point(48.5, 35.0), point(50.4, 30.5), point(46.6, 32.6)])
    ).toEqual([30.5, 46.6, 35.0, 50.4]);
  });

  it("returns a degenerate box for a single point", () => {
    expect(pointsBounds([point(48.5, 35.0)])).toEqual([35.0, 48.5, 35.0, 48.5]);
  });

  it("handles both hemispheres", () => {
    expect(pointsBounds([point(-33.9, -70.6), point(15.3, 44.2)])).toEqual([
      -70.6, -33.9, 44.2, 15.3,
    ]);
  });

  it("skips non-finite coordinates instead of poisoning the box", () => {
    expect(pointsBounds([BROKEN, point(48.5, 35.0)])).toEqual([35.0, 48.5, 35.0, 48.5]);
  });

  it("returns null when no point carries a usable coordinate", () => {
    expect(pointsBounds([BROKEN])).toBeNull();
  });

  // The shorter-arc rule: a plain min/max over these longitudes would return a
  // ~358-degree box and frame two neighbouring points as a world view.
  it("crosses the antimeridian on the short arc rather than spanning the globe", () => {
    expect(pointsBounds([point(65.0, 179.0), point(64.0, -179.0)])).toEqual([
      179, 64, 181, 65,
    ]);
  });

  it("keeps the plain box when the widest gap already straddles the seam", () => {
    expect(pointsBounds([point(48.5, -5.0), point(50.4, 12.0)])).toEqual([
      -5, 48.5, 12, 50.4,
    ]);
  });

  it("picks the widest gap when several points sit across the seam", () => {
    // 170, 178, -178 (= 182) and -170 (= 190): every inner gap is 8 or 12
    // degrees, so the enclosing arc runs 170 → 190.
    expect(
      pointsBounds([
        point(1, 170),
        point(2, 178),
        point(3, -178),
        point(4, -170),
      ])
    ).toEqual([170, 1, 190, 4]);
  });

  it("falls back to the plain box for points spread evenly around the globe", () => {
    // No dominant gap, so there is no tight framing to find and the answer is
    // a world view either way.
    expect(
      pointsBounds([point(0, -180), point(0, -90), point(0, 0), point(0, 90)])
    ).toEqual([-180, 0, 90, 0]);
  });
});

describe("hasFiniteCoords", () => {
  it("accepts a usable pair and rejects a broken one", () => {
    expect(hasFiniteCoords(point(48.5, 35.0))).toBe(true);
    expect(hasFiniteCoords(BROKEN)).toBe(false);
  });
});

// Pins the contract `services/event_filters.parse_bbox` enforces, not the
// literal: four numbers, `south,west,north,east` order, in range, and wide
// enough that no coordinate on the planet falls outside it.
describe("WORLD_BBOX", () => {
  it("is a box parse_bbox accepts that leaves no coordinate out", () => {
    const parts = WORLD_BBOX.split(",").map(Number);
    expect(parts).toHaveLength(4);
    expect(parts.every(Number.isFinite)).toBe(true);

    const [south, west, north, east] = parts;
    expect(south).toBeGreaterThanOrEqual(-90);
    expect(north).toBeLessThanOrEqual(90);
    expect(west).toBeGreaterThanOrEqual(-180);
    expect(east).toBeLessThanOrEqual(180);
    expect(south).toBeLessThanOrEqual(north);
    expect(west).toBeLessThanOrEqual(east);

    for (const [lat, lng] of [
      [-90, -180],
      [90, 180],
      [48.5, 35.0],
      [-33.9, -70.6],
    ]) {
      expect(lat).toBeGreaterThanOrEqual(south);
      expect(lat).toBeLessThanOrEqual(north);
      expect(lng).toBeGreaterThanOrEqual(west);
      expect(lng).toBeLessThanOrEqual(east);
    }
  });
});
