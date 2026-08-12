import { describe, expect, it } from "vitest";

import { projectEquirectangular } from "@/lib/og";

import { OG_LANDMASS_PATH, OG_LANDMASS_VIEWBOX } from "./landmass";

/** Every coordinate pair in the path, as the renderer would read them. */
function points(): [number, number][] {
  return Array.from(OG_LANDMASS_PATH.matchAll(/([ML])(-?[\d.]+) (-?[\d.]+)/g)).map(
    ([, , x, y]) => [Number(x), Number(y)],
  );
}

describe("OG_LANDMASS_PATH", () => {
  it("carries a world's worth of outline", () => {
    expect(OG_LANDMASS_PATH.length).toBeGreaterThan(1000);
    // Small enough to stay inline: the panel is a thumbnail, not an atlas.
    expect(OG_LANDMASS_PATH.length).toBeLessThan(8 * 1024);
  });

  it("is a closed set of subpaths", () => {
    expect(OG_LANDMASS_PATH.startsWith("M")).toBe(true);
    expect(OG_LANDMASS_PATH.endsWith("Z")).toBe(true);
    const moves = OG_LANDMASS_PATH.match(/M/g)?.length ?? 0;
    expect(moves).toBeGreaterThan(1);
    expect(OG_LANDMASS_PATH.match(/Z/g)?.length).toBe(moves);
  });

  it("uses only the commands a static outline needs", () => {
    expect(OG_LANDMASS_PATH.replace(/[ML][-\d. ]+|Z/g, "")).toBe("");
  });

  it("stays inside the frame it declares", () => {
    const all = points();
    expect(all.length).toBeGreaterThan(100);
    for (const [x, y] of all) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(OG_LANDMASS_VIEWBOX.width);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(OG_LANDMASS_VIEWBOX.height);
    }
  });
});

describe("OG_LANDMASS_VIEWBOX", () => {
  // The outline sits under the marker with no reprojection, so the frame it is
  // drawn in has to be the projection's unit square at 360x180. A change to
  // either side that is not matched on the other slides the coastline off the
  // crosshair.
  it("is the projection's frame, scaled", () => {
    for (const [lat, lng] of [
      [0, 0],
      [35.5, 35.8],
      [-33.9, 151.2],
      [64.1, -21.9],
    ]) {
      const { x, y } = projectEquirectangular(lat, lng);
      expect(x * OG_LANDMASS_VIEWBOX.width).toBeCloseTo(lng + 180, 6);
      expect(y * OG_LANDMASS_VIEWBOX.height).toBeCloseTo(90 - lat, 6);
    }
  });
});
