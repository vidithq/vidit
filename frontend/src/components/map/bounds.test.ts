import { describe, expect, it } from "vitest";
import type { MapPoint } from "@/types";

import { hasFiniteCoords, pointsBounds } from "./bounds";

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
    ).toEqual({ south: 46.6, west: 30.5, north: 50.4, east: 35.0 });
  });

  it("returns a degenerate box for a single point", () => {
    expect(pointsBounds([point(48.5, 35.0)])).toEqual({
      south: 48.5,
      west: 35.0,
      north: 48.5,
      east: 35.0,
    });
  });

  it("handles both hemispheres", () => {
    expect(pointsBounds([point(-33.9, -70.6), point(15.3, 44.2)])).toEqual({
      south: -33.9,
      west: -70.6,
      north: 15.3,
      east: 44.2,
    });
  });

  it("skips non-finite coordinates instead of poisoning the box", () => {
    expect(pointsBounds([BROKEN, point(48.5, 35.0)])).toEqual({
      south: 48.5,
      west: 35.0,
      north: 48.5,
      east: 35.0,
    });
  });

  it("returns null when no point carries a usable coordinate", () => {
    expect(pointsBounds([BROKEN])).toBeNull();
  });

  // The shorter-arc rule: a plain min/max over these longitudes would return a
  // ~358-degree box and frame two neighbouring points as a world view. The box
  // comes back unwrapped for MapLibre; `toBboxParam` widens it for a request
  // (see its own test).
  it("crosses the antimeridian on the short arc rather than spanning the globe", () => {
    expect(pointsBounds([point(65.0, 179.0), point(64.0, -179.0)])).toEqual({
      south: 64,
      west: 179,
      north: 65,
      east: 181,
    });
  });

  it("keeps the plain box when the widest gap already straddles the seam", () => {
    expect(pointsBounds([point(48.5, -5.0), point(50.4, 12.0)])).toEqual({
      south: 48.5,
      west: -5,
      north: 50.4,
      east: 12,
    });
  });

  it("picks the widest gap when several points sit across the seam", () => {
    // 170, 178, -178 (= 182) and -170 (= 190): every inner gap is 8 or 12
    // degrees, so the enclosing arc runs 170 → 190.
    expect(
      pointsBounds([point(1, 170), point(2, 178), point(3, -178), point(4, -170)])
    ).toEqual({ south: 1, west: 170, north: 4, east: 190 });
  });

  it("falls back to the plain box for points spread evenly around the globe", () => {
    // No dominant gap, so there is no tight framing to find and the answer is
    // a world view either way.
    expect(
      pointsBounds([point(0, -180), point(0, -90), point(0, 0), point(0, 90)])
    ).toEqual({ south: 0, west: -180, north: 0, east: 90 });
  });
});

describe("hasFiniteCoords", () => {
  it("accepts a usable pair and rejects a broken one", () => {
    expect(hasFiniteCoords(point(48.5, 35.0))).toBe(true);
    expect(hasFiniteCoords(BROKEN)).toBe(false);
  });
});
