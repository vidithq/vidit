import { describe, expect, it } from "vitest";
import type { Feature } from "geojson";

import {
  SPIDER_MAX_DOTS,
  STACK_EPSILON,
  groupStacks,
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

  it("never emits -0 cells at the equator or meridian", () => {
    expect(stackCellKey(-1e-6, -1e-6)).toBe(stackCellKey(0, 0));
    expect(stackCellKey(0, 0)).toBe("0,0");
  });
});

describe("groupStacks", () => {
  const coord = (p: { lat: number; lng: number }) => p;

  it("groups points sharing one cell", () => {
    const a = { lat: 48.64570, lng: 35.20788 };
    const b = { lat: 48.6457041, lng: 35.2078801 };
    const groups = groupStacks([a, b], coord);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
  });

  it("groups points within the epsilon straddling a grid line", () => {
    // 4e-6 and 6e-6 round to different cells (0 and 1) but sit 2e-6 apart.
    const a = { lat: 48.2, lng: 35.000004 };
    const b = { lat: 48.2, lng: 35.000006 };
    const groups = groupStacks([a, b], coord);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
  });

  it("groups a stack straddling the equator", () => {
    const a = { lat: -1e-6, lng: 35.2 };
    const b = { lat: 1e-6, lng: 35.2 };
    expect(groupStacks([a, b], coord)).toHaveLength(1);
  });

  it("keeps neighbor-cell points past the epsilon apart", () => {
    const a = { lat: 48.2, lng: 35.000001 };
    const b = { lat: 48.2, lng: 35.000014 };
    expect(groupStacks([a, b], coord)).toHaveLength(2);
  });

  it("keeps far points apart", () => {
    const a = { lat: 48.2, lng: 35.2 };
    const b = { lat: 48.3, lng: 35.2 };
    expect(groupStacks([a, b], coord)).toHaveLength(2);
  });
});

describe("ring layout", () => {
  it("keeps a small radius for small stacks and grows for large ones", () => {
    expect(ringRadius(2)).toBe(18);
    expect(ringRadius(4)).toBe(18);
    expect(ringRadius(20)).toBeGreaterThan(18);
  });

  it("stops growing past the dot cap", () => {
    expect(ringRadius(100)).toBe(ringRadius(SPIDER_MAX_DOTS));
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
