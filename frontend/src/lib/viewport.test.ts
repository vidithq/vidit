import { describe, expect, it } from "vitest";
import {
  VIEWPORT_PADDING,
  boundsContain,
  normalizeBounds,
  padBounds,
  toBboxParam,
  type MapBounds,
} from "./viewport";

const UKRAINE: MapBounds = { south: 45, west: 30, north: 50, east: 40 };

describe("normalizeBounds", () => {
  it("passes an in-range viewport through", () => {
    expect(normalizeBounds(UKRAINE)).toEqual(UKRAINE);
  });

  it("shifts an unwrapped viewport back into range", () => {
    // Panning east past the antimeridian: MapLibre keeps counting up.
    expect(normalizeBounds({ south: 0, west: 190, north: 10, east: 200 })).toEqual({
      south: 0,
      west: -170,
      north: 10,
      east: -160,
    });
  });

  it("widens a viewport that straddles the antimeridian", () => {
    // The endpoint models no west > east box, so the whole range is the
    // only correct answer: dropping half the viewport is not.
    expect(normalizeBounds({ south: 0, west: 170, north: 10, east: 190 })).toEqual({
      south: 0,
      west: -180,
      north: 10,
      east: 180,
    });
  });

  it("clamps a zoomed-out viewport to the valid ranges", () => {
    expect(normalizeBounds({ south: -120, west: -400, north: 120, east: 400 })).toEqual({
      south: -90,
      west: -180,
      north: 90,
      east: 180,
    });
  });
});

describe("padBounds", () => {
  it("grows the box by the padding factor on every side", () => {
    const padded = padBounds(UKRAINE);
    expect(padded.south).toBeCloseTo(45 - 5 * VIEWPORT_PADDING);
    expect(padded.north).toBeCloseTo(50 + 5 * VIEWPORT_PADDING);
    expect(padded.west).toBeCloseTo(30 - 10 * VIEWPORT_PADDING);
    expect(padded.east).toBeCloseTo(40 + 10 * VIEWPORT_PADDING);
  });

  it("never pads past the valid ranges", () => {
    const padded = padBounds({ south: -89, west: -179, north: 89, east: 179 });
    expect(padded.south).toBe(-90);
    expect(padded.north).toBe(90);
    expect(padded.west).toBe(-180);
    expect(padded.east).toBe(180);
  });
});

describe("boundsContain", () => {
  const covered = padBounds(UKRAINE);

  it("accepts a pan the padding already covers, so no refetch fires", () => {
    expect(boundsContain(covered, { south: 45.5, west: 30.5, north: 50.5, east: 40.5 })).toBe(true);
  });

  it("rejects a pan past the padding", () => {
    expect(boundsContain(covered, { south: 45, west: 30, north: 50, east: 43 })).toBe(false);
  });

  it("rejects a zoom-out, which widens the viewport past what was fetched", () => {
    expect(boundsContain(covered, { south: 40, west: 25, north: 55, east: 45 })).toBe(false);
  });
});

describe("toBboxParam", () => {
  it("serialises in the south,west,north,east order the endpoint parses", () => {
    expect(toBboxParam(UKRAINE)).toBe("45,30,50,40");
  });

  it("rounds outward, so the string never describes a smaller box", () => {
    const param = toBboxParam({
      south: 45.000059,
      west: 30.000059,
      north: 50.000011,
      east: 40.000011,
    });
    const [south, west, north, east] = param.split(",").map(Number);
    expect(south).toBeLessThanOrEqual(45.000059);
    expect(west).toBeLessThanOrEqual(30.000059);
    expect(north).toBeGreaterThanOrEqual(50.000011);
    expect(east).toBeGreaterThanOrEqual(40.000011);
  });

  it("collapses sub-precision jitter onto one value, so the server cache hits", () => {
    const a = toBboxParam({ south: 45.000001, west: 30, north: 50, east: 40 });
    const b = toBboxParam({ south: 45.000002, west: 30, north: 50, east: 40 });
    expect(a).toBe(b);
  });
});
