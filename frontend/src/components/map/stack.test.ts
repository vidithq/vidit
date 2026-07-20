import { describe, expect, it } from "vitest";
import type { Feature } from "geojson";

import {
  STACK_EPSILON,
  isCoincidentStack,
  ringOffsets,
  ringRadius,
  stackCellKey,
} from "./stack";

function point(lng: number, lat: number): Feature {
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "Point", coordinates: [lng, lat] },
  };
}

describe("isCoincidentStack", () => {
  it("is true for identical coordinates", () => {
    expect(
      isCoincidentStack([point(35.1, 48.2), point(35.1, 48.2), point(35.1, 48.2)])
    ).toBe(true);
  });

  it("tolerates float noise within the epsilon", () => {
    expect(
      isCoincidentStack([
        point(35.1, 48.2),
        point(35.1 + STACK_EPSILON / 2, 48.2 - STACK_EPSILON / 2),
      ])
    ).toBe(true);
  });

  it("is false once any point sits past the epsilon", () => {
    expect(
      isCoincidentStack([point(35.1, 48.2), point(35.1, 48.2 + 1e-3)])
    ).toBe(false);
  });

  it("is false for fewer than two points", () => {
    expect(isCoincidentStack([])).toBe(false);
    expect(isCoincidentStack([point(35.1, 48.2)])).toBe(false);
  });
});

describe("stackCellKey", () => {
  it("groups coordinates that agree to the 1e-5 grid", () => {
    expect(stackCellKey(48.6457041, 35.2078801)).toBe(
      stackCellKey(48.64570, 35.20788)
    );
  });

  it("separates coordinates farther apart than the grid", () => {
    expect(stackCellKey(48.6457, 35.2078)).not.toBe(
      stackCellKey(48.6459, 35.2078)
    );
  });
});

describe("ring layout", () => {
  it("keeps a small radius for small stacks and grows for large ones", () => {
    expect(ringRadius(2)).toBe(18);
    expect(ringRadius(4)).toBe(18);
    expect(ringRadius(20)).toBeGreaterThan(18);
  });

  it("spaces n offsets evenly on the ring, first at the top", () => {
    const n = 5;
    const r = ringRadius(n);
    const offsets = ringOffsets(n);
    expect(offsets).toHaveLength(n);
    expect(offsets[0].dx).toBeCloseTo(0);
    expect(offsets[0].dy).toBeCloseTo(-r);
    for (const { dx, dy } of offsets) {
      expect(Math.hypot(dx, dy)).toBeCloseTo(r);
    }
    // Neighbouring dots stay a full dot apart on the circumference.
    const gap = Math.hypot(
      offsets[1].dx - offsets[0].dx,
      offsets[1].dy - offsets[0].dy
    );
    expect(gap).toBeGreaterThanOrEqual(12);
  });
});
