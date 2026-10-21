import { describe, expect, it } from "vitest";

import {
  nearestPointOnZone,
  positionsBounds,
  zoneAreaKm2,
  zoneFromVertices,
  zoneSelfCrosses,
  zoneVertices,
  type Position,
} from "./siteZone";

const SQUARE: Position[] = [
  [30, 10],
  [30.01, 10],
  [30.01, 10.01],
  [30, 10.01],
];

describe("zone rings", () => {
  it("closes the ring on its first corner and opens it again", () => {
    const zone = zoneFromVertices(SQUARE);
    expect(zone.coordinates[0]).toHaveLength(5);
    expect(zone.coordinates[0][4]).toEqual([30, 10]);
    expect(zoneVertices(zone)).toEqual(SQUARE);
  });
});

describe("zoneAreaKm2", () => {
  it("measures a 0.01 degree square near the equator at about 1.2 km²", () => {
    expect(zoneAreaKm2(SQUARE)).toBeCloseTo(1.21, 1);
  });

  it("is zero below three corners", () => {
    expect(zoneAreaKm2(SQUARE.slice(0, 2))).toBe(0);
  });
});

describe("zoneSelfCrosses", () => {
  it("accepts a simple ring", () => {
    expect(zoneSelfCrosses(SQUARE)).toBe(false);
  });

  it("flags a bow tie", () => {
    expect(zoneSelfCrosses([SQUARE[0], SQUARE[2], SQUARE[1], SQUARE[3]])).toBe(true);
  });
});

describe("nearestPointOnZone", () => {
  it("drops a point north of the square onto its north edge", () => {
    const [lng, lat] = nearestPointOnZone(zoneFromVertices(SQUARE), [30.005, 10.05]);
    expect(lng).toBeCloseTo(30.005, 6);
    expect(lat).toBeCloseTo(10.01, 6);
  });

  it("drops a point past a corner onto that corner", () => {
    const [lng, lat] = nearestPointOnZone(zoneFromVertices(SQUARE), [29.9, 9.9]);
    expect(lng).toBeCloseTo(30, 6);
    expect(lat).toBeCloseTo(10, 6);
  });
});

describe("positionsBounds", () => {
  it("boxes every position, or none for none", () => {
    expect(positionsBounds(SQUARE)).toEqual({ south: 10, west: 30, north: 10.01, east: 30.01 });
    expect(positionsBounds([])).toBeNull();
  });
});
