import {
  createExpression,
  featureFilter,
  validateStyleMin,
} from "@maplibre/maplibre-gl-style-spec";
import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildViditStyle,
  DEFAULT_BASEMAP_OPTIONS,
  LOW_ZOOM,
  VIDIT_STYLES,
  type BasemapOptions,
} from "./basemap";

type Layer = LayerSpecification & {
  filter?: unknown;
  layout?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  "source-layer"?: string;
};

const BASES = Object.entries(VIDIT_STYLES);
const GLYPHS_DIR = join(process.cwd(), "public", "map-glyphs");

function build(base: StyleSpecification, options: Partial<BasemapOptions> = {}): Layer[] {
  return buildViditStyle(base, { ...DEFAULT_BASEMAP_OPTIONS, ...options }).layers as Layer[];
}

function withRole(layers: Layer[], role: string): Layer[] {
  return layers.filter((layer) => layer.metadata?.["vidit:role"] === role);
}

function visible(layer: Layer): boolean {
  return layer.layout?.visibility !== "none";
}

function shows(layer: Layer, zoom: number, properties: Record<string, unknown>): boolean {
  if (zoom < (layer.minzoom ?? 0) || zoom >= (layer.maxzoom ?? 24)) return false;
  const { filter } = featureFilter(layer.filter as never, "filter");
  return filter({ zoom }, { type: 1, properties, geometry: [] } as never);
}

function labelOf(layer: Layer, properties: Record<string, unknown>): unknown {
  const parsed = createExpression(layer.layout?.["text-field"], "text-field");
  if (parsed.result !== "success") throw new Error("text-field does not parse");
  return parsed.value.evaluate({ zoom: 10 }, { type: 1, properties } as never);
}

describe.each(BASES)("buildViditStyle on the %s style", (_, base) => {
  it("validates against the style spec with every option set", () => {
    for (const options of [
      DEFAULT_BASEMAP_OPTIONS,
      { language: "both", density: "normal", regionBorders: true, roads: false },
      { language: "local", density: "sparse", regionBorders: false, roads: true },
    ] as BasemapOptions[]) {
      expect(validateStyleMin(buildViditStyle(base, options))).toEqual([]);
    }
  });

  it("names only fontstacks the glyph build committed", () => {
    expect(base.glyphs).toBe("/map-glyphs/{fontstack}/{range}.pbf");
    const stacks = new Set(
      (base.layers as Layer[]).flatMap((layer) => {
        const fonts = layer.layout?.["text-font"] as string[] | undefined;
        return fonts ? [fonts.join(",")] : [];
      }),
    );
    expect(stacks.size).toBeGreaterThan(0);
    for (const stack of stacks) {
      expect(existsSync(join(GLYPHS_DIR, stack, "0-255.pbf")), stack).toBe(true);
    }
  });

  it("tags every place label, region border and road layer", () => {
    for (const layer of base.layers as Layer[]) {
      const sourceLayer = layer["source-layer"];
      const role = layer.metadata?.["vidit:role"];
      if (sourceLayer === "place") expect(role, layer.id).toBe("place-label");
      if (sourceLayer === "transportation_name") expect(role, layer.id).toBe("road-label");
      if (sourceLayer === "boundary" && JSON.stringify(layer.filter).match(/admin_level"\],\s*2\]/)) {
        expect(role, layer.id).toBeUndefined();
      }
    }
    expect(withRole(base.layers as Layer[], "region-border")).not.toHaveLength(0);
  });

  it("labels only countries and capitals below the low zoom by default", () => {
    const places = withRole(build(base), "place-label");
    const below = LOW_ZOOM - 1;
    const anyShows = (zoom: number, properties: Record<string, unknown>) =>
      places.some((layer) => shows(layer, zoom, properties));

    expect(anyShows(3, { class: "country", rank: 1, iso_a2: "UA" })).toBe(true);
    expect(anyShows(below, { class: "city", capital: 2, rank: 1 })).toBe(true);
    expect(anyShows(below, { class: "city", rank: 1 })).toBe(false);
    expect(anyShows(below, { class: "state" })).toBe(false);
    expect(anyShows(LOW_ZOOM, { class: "city", rank: 1 })).toBe(true);
    expect(anyShows(LOW_ZOOM, { class: "town", rank: 5 })).toBe(false);
    expect(anyShows(LOW_ZOOM, { class: "state" })).toBe(false);
    expect(anyShows(9, { class: "village" })).toBe(false);
  });

  it("keeps the upstream place labels at normal density", () => {
    const places = withRole(build(base, { density: "normal" }), "place-label");
    expect(
      places.some((layer) => shows(layer, LOW_ZOOM - 1, { class: "city", rank: 1 })),
    ).toBe(true);
  });

  it("holds every other label and road back to the low zoom when sparse", () => {
    const layers = build(base);
    for (const role of ["label", "road", "road-label"]) {
      for (const layer of withRole(layers, role)) {
        expect(layer.minzoom ?? 0, layer.id).toBeGreaterThanOrEqual(LOW_ZOOM);
      }
    }
    for (const layer of withRole(layers, "minor-road")) {
      expect(layer.minzoom ?? 0, layer.id).toBeGreaterThanOrEqual(12);
    }
    const normal = build(base, { density: "normal" });
    expect(withRole(normal, "minor-road").map((l) => l.minzoom)).toEqual(
      withRole(base.layers as Layer[], "minor-road").map((l) => l.minzoom),
    );
  });

  it("hides region borders and keeps country borders by default", () => {
    const layers = build(base);
    expect(withRole(layers, "region-border").every((layer) => !visible(layer))).toBe(true);
    const countries = layers.filter(
      (layer) => layer["source-layer"] === "boundary" && !layer.metadata,
    );
    expect(countries).not.toHaveLength(0);
    expect(countries.every(visible)).toBe(true);
    expect(withRole(build(base, { regionBorders: true }), "region-border").every(visible)).toBe(
      true,
    );
  });

  it("hides every road layer when roads are off", () => {
    const layers = build(base, { roads: false });
    for (const role of ["road", "minor-road", "road-label"]) {
      expect(withRole(layers, role).every((layer) => !visible(layer))).toBe(true);
    }
    expect(withRole(build(base), "road").every(visible)).toBe(true);
  });

  it("writes one language per label, Latin by default", () => {
    const kyiv = { name: "Київ", "name:latin": "Kyiv", "name:nonlatin": "Київ" };
    const city = withRole(build(base), "place-label")[0];
    expect(labelOf(city, kyiv)).toBe("Kyiv");
    expect(labelOf(city, { name: "Lviv" })).toBe("Lviv");

    const local = withRole(build(base, { language: "local" }), "place-label")[0];
    expect(labelOf(local, kyiv)).toBe("Київ");

    const both = withRole(build(base, { language: "both" }), "place-label")[0];
    expect(labelOf(both, kyiv)).toBe("Kyiv\nКиїв");
  });

  it("leaves road shields on their reference", () => {
    const shields = withRole(build(base), "road-label").filter((layer) =>
      JSON.stringify(layer.layout?.["text-field"] ?? null).includes('"ref"'),
    );
    for (const layer of shields) {
      expect(JSON.stringify(layer.layout?.["text-field"])).not.toContain('"name');
    }
  });
});
