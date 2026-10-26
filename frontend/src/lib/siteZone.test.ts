import { describe, expect, it } from "vitest";

import {
  EMPTY_DRAW,
  drawFromZone,
  drawReady,
  edgeMidpoints,
  insertVertex,
  moveVertex,
  nearestPointOnZone,
  removeVertex,
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

describe("contour editing", () => {
  const closed = drawFromZone(zoneFromVertices(SQUARE));

  it("starts from a stored zone as a closed ring with no corner picked", () => {
    expect(closed).toEqual({ vertices: SQUARE, closed: true, selected: null });
    expect(drawReady(closed)).toBe(true);
    expect(drawReady(EMPTY_DRAW)).toBe(false);
  });

  it("puts a handle in the middle of every edge, the last one closing the ring", () => {
    const mids = edgeMidpoints(SQUARE);
    expect(mids).toHaveLength(4);
    expect(mids[0][0]).toBeCloseTo(30.005);
    expect(mids[0][1]).toBeCloseTo(10);
    expect(mids[3][0]).toBeCloseTo(30);
    expect(mids[3][1]).toBeCloseTo(10.005);
  });

  it("inserts a corner after the edge's first corner and picks it", () => {
    const next = insertVertex(closed, 1, [30.02, 10.005]);
    expect(next.vertices).toHaveLength(5);
    expect(next.vertices[2]).toEqual([30.02, 10.005]);
    expect(next.selected).toBe(2);
    expect(closed.vertices).toHaveLength(4);
  });

  it("moves one corner and leaves the rest", () => {
    const next = moveVertex(closed, 0, [29.99, 9.99]);
    expect(next.vertices[0]).toEqual([29.99, 9.99]);
    expect(next.vertices.slice(1)).toEqual(SQUARE.slice(1));
  });

  it("removes a corner, and keeps the last three of a closed ring", () => {
    const four = removeVertex({ ...closed, selected: 1 }, 1);
    expect(four.vertices).toHaveLength(3);
    expect(four.selected).toBeNull();
    expect(removeVertex(four, 0)).toBe(four);
  });

  it("refuses a closed ring whose edges cross", () => {
    const bowtie = { vertices: [SQUARE[0], SQUARE[2], SQUARE[1], SQUARE[3]], closed: true, selected: null };
    expect(drawReady(bowtie)).toBe(false);
  });
});
