import { describe, expect, it } from "vitest";
import type { MapPoint } from "@/types";

import { WORLD_BBOX, pointsBounds } from "./bounds";

function point(lat: number, lng: number): MapPoint {
  return ["id", lat, lng, null, "2026-01-01", 0, 0];
}

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
    const broken = ["id", Number.NaN, Number.NaN, null, "2026-01-01", 0, 0] as MapPoint;
    expect(pointsBounds([broken, point(48.5, 35.0)])).toEqual([35.0, 48.5, 35.0, 48.5]);
  });

  it("returns null when no point carries a usable coordinate", () => {
    const broken = ["id", Number.NaN, Number.NaN, null, "2026-01-01", 0, 0] as MapPoint;
    expect(pointsBounds([broken])).toBeNull();
  });
});

describe("WORLD_BBOX", () => {
  it("is the full planet in the endpoint's south,west,north,east order", () => {
    expect(WORLD_BBOX.split(",").map(Number)).toEqual([-90, -180, 90, 180]);
  });
});
