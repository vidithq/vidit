import { describe, expect, it } from "vitest";

import { formatDegrees, graticule, gridStep, GRID_STEPS } from "./graticule";

const EUROPE = { south: 40, west: 0, north: 60, east: 40 };

function labels(kind: "parallel" | "meridian", zoom: number, bounds = EUROPE): string[] {
  return graticule(bounds, zoom)
    .features.filter((feature) => feature.properties.kind === kind)
    .map((feature) => feature.properties.label);
}

describe("gridStep", () => {
  it("narrows as the map zooms in, from 30 degrees on the globe to a thousandth", () => {
    expect(gridStep(1.8)).toBe(30);
    expect(gridStep(5)).toBe(5);
    expect(gridStep(10)).toBe(0.1);
    expect(gridStep(22)).toBe(0.001);
    const steps = [2, 4, 6, 8, 10, 12, 14].map(gridStep);
    expect(steps).toEqual([...steps].sort((a, b) => b - a));
  });

  it("picks only steps that divide a right angle", () => {
    for (const step of GRID_STEPS) expect(Math.abs(90 / step - Math.round(90 / step))).toBeLessThan(1e-9);
  });
});

describe("formatDegrees", () => {
  it("writes the hemisphere after the absolute value", () => {
    expect(formatDegrees(30, "lat", 0)).toBe("30°N");
    expect(formatDegrees(-12.5, "lat", 1)).toBe("12.5°S");
    expect(formatDegrees(-0.25, "lng", 2)).toBe("0.25°W");
    expect(formatDegrees(0, "lat", 0)).toBe("0°");
    expect(formatDegrees(180, "lng", 0)).toBe("180°");
  });

  it("wraps a longitude past the antimeridian", () => {
    expect(formatDegrees(190, "lng", 0)).toBe("170°W");
    expect(formatDegrees(-200, "lng", 0)).toBe("160°E");
  });
});

describe("graticule", () => {
  it("draws the lines of the view and as much again on each side", () => {
    expect(labels("parallel", 5)).toEqual(["30°N", "35°N", "40°N", "45°N", "50°N", "55°N", "60°N", "65°N", "70°N"]);
    expect(labels("meridian", 5)).toContain("20°W");
    expect(labels("meridian", 5)).toContain("60°E");
    expect(labels("meridian", 5)).not.toContain("65°E");
  });

  it("puts a vertex at every crossing, so a line follows the globe", () => {
    const { features } = graticule(EUROPE, 5);
    const parallel = features.find((feature) => feature.properties.label === "50°N");
    const meridians = features.filter((feature) => feature.properties.kind === "meridian");
    const vertices = parallel?.geometry.coordinates.map(([lng]) => lng) ?? [];
    for (const meridian of meridians) expect(vertices).toContain(meridian.geometry.coordinates[0][0]);
    expect(parallel?.geometry.coordinates.every(([, lat]) => lat === 50)).toBe(true);
  });

  it("prints decimals at a fine step without float noise", () => {
    const city = { south: 50.4, west: 30.4, north: 50.5, east: 30.6 };
    expect(labels("parallel", 12, city)).toContain("50.44°N");
    expect(labels("meridian", 12, city).every((label) => /^\d+(\.\d{1,2})?°E$/.test(label))).toBe(true);
  });

  it("stops the parallels short of the poles and keeps the latitude in range", () => {
    const world = { south: -90, west: -180, north: 90, east: 180 };
    const { features } = graticule(world, 1.8);
    expect(labels("parallel", 1.8, world)).toEqual(["60°S", "30°S", "0°", "30°N", "60°N"]);
    for (const feature of features) {
      for (const [, lat] of feature.geometry.coordinates) expect(Math.abs(lat)).toBeLessThanOrEqual(90);
    }
  });

  it("coarsens the step when a view spans too many lines for its zoom", () => {
    const polar = { south: 70, west: -180, north: 90, east: 180 };
    expect(graticule(polar, 8).features.length).toBeLessThanOrEqual(2 * 120);
  });

  it("labels a view across the antimeridian with wrapped longitudes", () => {
    const pacific = { south: -10, west: 170, north: 10, east: 190 };
    const meridians = labels("meridian", 5, pacific);
    expect(meridians).toContain("180°");
    expect(meridians).toContain("175°W");
  });
});
