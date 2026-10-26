import {
  createExpression,
  featureFilter,
  validateStyleMin,
} from "@maplibre/maplibre-gl-style-spec";
import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { MAP_LAYER_COLORS } from "@/lib/palette";

import {
  BASEMAP_PRESET_IDS,
  BASEMAP_PRESETS,
  BLANK_STYLE,
  buildViditStyle,
  carryOverlays,
  aboveBasemap,
  DEFAULT_BASEMAP_OPTIONS,
  isOverlaySource,
  LOW_ZOOM,
  resolvePreset,
  VIDIT_STYLES,
  type BasemapOptions,
  type BasemapPresetId,
  type Brightness,
} from "./basemap";
import { DAILY_IMAGERY_SOURCE } from "./gibs";

type Layer = LayerSpecification & {
  filter?: unknown;
  layout?: Record<string, unknown>;
  paint?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  "source-layer"?: string;
};

const BASES = Object.entries(VIDIT_STYLES) as [Brightness, StyleSpecification][];
const GLYPHS_DIR = join(process.cwd(), "public", "map-glyphs");
const SPRITES_DIR = join(process.cwd(), "public", "map-sprites");

function build(brightness: Brightness, options: Partial<BasemapOptions> = {}): Layer[] {
  return buildViditStyle(brightness, { ...DEFAULT_BASEMAP_OPTIONS, ...options }).layers as Layer[];
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

describe.each(BASES)("buildViditStyle on the %s style", (brightness, base) => {
  it("validates against the style spec with every option set", () => {
    for (const options of [
      DEFAULT_BASEMAP_OPTIONS,
      { language: "both", density: "normal", regionBorders: true, roads: false, buildings: false, militaryAndAirports: false, relief: true, disputedDashed: false },
      { language: "local", density: "sparse", regionBorders: false, roads: true, buildings: true, militaryAndAirports: true, relief: false, disputedDashed: true },
    ] as BasemapOptions[]) {
      expect(validateStyleMin(buildViditStyle(brightness, options))).toEqual([]);
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

  it("loads the icons from the vendored sprite", () => {
    expect(base.sprite).toBe("/map-sprites/ofm");
    for (const file of ["ofm.json", "ofm.png", "ofm@2x.json", "ofm@2x.png"]) {
      expect(existsSync(join(SPRITES_DIR, file)), file).toBe(true);
    }
  });

  it("tags every place label, region border and road layer", () => {
    for (const layer of base.layers as Layer[]) {
      const sourceLayer = layer["source-layer"];
      const role = layer.metadata?.["vidit:role"];
      if (sourceLayer === "place") expect(role, layer.id).toBe("place-label");
      if (sourceLayer === "transportation_name") expect(role, layer.id).toBe("road-label");
      if (sourceLayer === "boundary" && JSON.stringify(layer.filter).match(/admin_level"\],\s*2\]/)) {
        expect([undefined, "disputed-border"], layer.id).toContain(role);
      }
    }
    expect(withRole(base.layers as Layer[], "region-border")).not.toHaveLength(0);
  });

  it("labels only countries and capitals below the low zoom by default", () => {
    const places = withRole(build(brightness), "place-label");
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
    const places = withRole(build(brightness, { density: "normal" }), "place-label");
    expect(
      places.some((layer) => shows(layer, LOW_ZOOM - 1, { class: "city", rank: 1 })),
    ).toBe(true);
  });

  it("holds every other label and road back to the low zoom when sparse", () => {
    const layers = build(brightness);
    for (const role of ["label", "road", "road-label"]) {
      for (const layer of withRole(layers, role)) {
        expect(layer.minzoom ?? 0, layer.id).toBeGreaterThanOrEqual(LOW_ZOOM);
      }
    }
    for (const layer of withRole(layers, "minor-road")) {
      expect(layer.minzoom ?? 0, layer.id).toBeGreaterThanOrEqual(12);
    }
    const normal = build(brightness, { density: "normal" });
    expect(withRole(normal, "minor-road").map((l) => l.minzoom)).toEqual(
      withRole(base.layers as Layer[], "minor-road").map((l) => l.minzoom),
    );
  });

  it("hides region borders and keeps country borders by default", () => {
    const layers = build(brightness);
    expect(withRole(layers, "region-border").every((layer) => !visible(layer))).toBe(true);
    const countries = layers.filter(
      (layer) => layer["source-layer"] === "boundary" && !layer.metadata,
    );
    expect(countries).not.toHaveLength(0);
    expect(countries.every(visible)).toBe(true);
    expect(withRole(build(brightness, { regionBorders: true }), "region-border").every(visible)).toBe(
      true,
    );
  });

  it("hides every road layer when roads are off", () => {
    const layers = build(brightness, { roads: false });
    for (const role of ["road", "minor-road", "road-label"]) {
      expect(withRole(layers, role).every((layer) => !visible(layer))).toBe(true);
    }
    expect(withRole(build(brightness), "road").every(visible)).toBe(true);
  });

  it("draws buildings by default and hides them when off", () => {
    expect(withRole(base.layers as Layer[], "building")).not.toHaveLength(0);
    for (const layer of base.layers as Layer[]) {
      if (layer["source-layer"] === "building") expect(layer.metadata?.["vidit:role"], layer.id).toBe("building");
    }
    expect(withRole(build(brightness), "building").every(visible)).toBe(true);
    expect(withRole(build(brightness, { buildings: false }), "building").every((layer) => !visible(layer))).toBe(
      true,
    );
  });

  it("dashes disputed country borders by default and leaves the settled ones solid", () => {
    const layers = build(brightness);
    const borders = layers.filter((layer) => layer["source-layer"] === "boundary");
    const disputed = withRole(layers, "disputed-border");
    const countries = borders.filter((layer) => !layer.metadata);
    const crimea = { admin_level: 2, disputed: 1, maritime: 0, claimed_by: "RU" };
    const settled = { admin_level: 2, disputed: 0, maritime: 0, adm0_l: "RUS", adm0_r: "UKR" };

    expect(disputed).toHaveLength(1);
    for (const zoom of [3, 6, 10]) {
      expect(shows(disputed[0], zoom, crimea), `z${zoom}`).toBe(true);
      expect(countries.some((layer) => shows(layer, zoom, crimea)), `z${zoom}`).toBe(false);
      expect(countries.some((layer) => shows(layer, zoom, settled)), `z${zoom}`).toBe(true);
    }
    expect(disputed[0].paint).toHaveProperty("line-dasharray");
    for (const layer of countries) expect(layer.paint, layer.id).not.toHaveProperty("line-dasharray");

    const solid = withRole(build(brightness, { disputedDashed: false }), "disputed-border")[0];
    expect(solid.paint).not.toHaveProperty("line-dasharray");
    expect(visible(solid)).toBe(true);
  });

  it("highlights military areas and airports above the aeroways and under the roads by default", () => {
    const layers = build(brightness);
    const highlights = withRole(layers, "military-airport");
    const anyShows = (sourceLayer: string, properties: Record<string, unknown>) =>
      highlights.some((layer) => layer["source-layer"] === sourceLayer && shows(layer, 12, properties));

    expect(highlights.every(visible)).toBe(true);
    expect(anyShows("landuse", { class: "military" })).toBe(true);
    expect(anyShows("landuse", { class: "industrial" })).toBe(false);
    expect(anyShows("aeroway", { class: "aerodrome" })).toBe(true);
    expect(highlights.some((layer) => layer.type === "line" && JSON.stringify(layer.filter).includes("runway"))).toBe(
      true,
    );

    const ids = layers.map((layer) => layer.id);
    const lastAeroway = Math.max(
      ...layers.flatMap((layer, i) => (layer["source-layer"] === "aeroway" && !layer.metadata ? [i] : [])),
    );
    const firstHighlight = ids.indexOf(highlights[0].id);
    expect(firstHighlight).toBe(lastAeroway + 1);
    // Only tunnels, which run under the ground, draw beneath the highlights.
    const roadsBelow = withRole(layers, "road").filter((layer) => ids.indexOf(layer.id) < firstHighlight);
    expect(roadsBelow.every((layer) => layer.id.startsWith("tunnel_"))).toBe(true);

    const colors = MAP_LAYER_COLORS[brightness];
    const paints = JSON.stringify(highlights.map((layer) => layer.paint));
    expect(paints).toContain(colors.military);
    expect(paints).toContain(colors.airport);
  });

  it("hides the military and airport highlights when off", () => {
    const highlights = withRole(build(brightness, { militaryAndAirports: false }), "military-airport");
    expect(highlights).not.toHaveLength(0);
    expect(highlights.every((layer) => !visible(layer))).toBe(true);
  });

  it("shades the relief above the land fills and under everything drawn on the land, when on", () => {
    const layers = build(brightness, { relief: true });
    const [relief] = withRole(layers, "relief");
    expect(relief.type).toBe("hillshade");
    expect(visible(relief)).toBe(true);

    const at = layers.indexOf(relief);
    const land = new Set(["water", "landcover", "landuse", "park"]);
    for (const [i, layer] of layers.entries()) {
      const fill = land.has(layer["source-layer"] ?? "") && !layer.metadata;
      if (fill) expect(i, layer.id).toBeLessThan(at);
      if (layer.type === "symbol" || layer.metadata?.["vidit:role"] === "road") expect(i, layer.id).toBeGreaterThan(at);
    }
    for (const layer of withRole(layers, "military-airport")) expect(layers.indexOf(layer)).toBeGreaterThan(at);

    const source = buildViditStyle(brightness, DEFAULT_BASEMAP_OPTIONS).sources[(relief as { source: string }).source];
    expect(source).toMatchObject({ type: "raster-dem", encoding: "terrarium", maxzoom: 15 });
    expect(JSON.stringify(source)).toContain("Terrain Tiles");
    expect(JSON.stringify(relief.paint)).toContain(MAP_LAYER_COLORS[brightness].reliefShadow);
  });

  it("hides the relief by default", () => {
    expect(withRole(build(brightness), "relief").every((layer) => !visible(layer))).toBe(true);
  });

  it("writes one language per label, Latin by default", () => {
    const kyiv = { name: "Київ", "name:latin": "Kyiv", "name:nonlatin": "Київ" };
    const city = withRole(build(brightness), "place-label")[0];
    expect(labelOf(city, kyiv)).toBe("Kyiv");
    expect(labelOf(city, { name: "Lviv" })).toBe("Lviv");

    const local = withRole(build(brightness, { language: "local" }), "place-label")[0];
    expect(labelOf(local, kyiv)).toBe("Київ");

    const both = withRole(build(brightness, { language: "both" }), "place-label")[0];
    expect(labelOf(both, kyiv)).toBe("Kyiv\nКиїв");
  });

  it("leaves road shields on their reference", () => {
    const shields = withRole(build(brightness), "road-label").filter((layer) =>
      JSON.stringify(layer.layout?.["text-field"] ?? null).includes('"ref"'),
    );
    for (const layer of shields) {
      expect(JSON.stringify(layer.layout?.["text-field"])).not.toContain('"name');
    }
  });
});

describe("basemap presets", () => {
  it("resolves Auto to the Vidit style of the theme", () => {
    expect(resolvePreset("auto", "dark")).toBe("vidit-dark");
    expect(resolvePreset("auto", "light")).toBe("vidit-light");
    expect(resolvePreset("terrain", "dark")).toBe("terrain");
  });

  it("declares each preset's brightness, which the halo and the tint follow", () => {
    expect(BASEMAP_PRESETS["vidit-dark"].brightness).toBe("dark");
    expect(BASEMAP_PRESETS.satellite.brightness).toBe("dark");
    for (const id of ["vidit-light", "streets", "terrain"] as const) {
      expect(BASEMAP_PRESETS[id].brightness, id).toBe("light");
    }
  });

  it("applies the reader's options to the Vidit styles only", () => {
    const off = { ...DEFAULT_BASEMAP_OPTIONS, roads: false };
    for (const id of ["streets", "terrain", "satellite"] as const) {
      expect(BASEMAP_PRESETS[id].adjustable, id).toBe(false);
      expect(BASEMAP_PRESETS[id].style(off)).toEqual(BASEMAP_PRESETS[id].style(DEFAULT_BASEMAP_OPTIONS));
    }
    const dark = BASEMAP_PRESETS["vidit-dark"].style(off) as StyleSpecification;
    expect(withRole(dark.layers as Layer[], "road").every((layer) => !visible(layer))).toBe(true);
  });

  it("builds valid object styles", () => {
    expect(validateStyleMin(BLANK_STYLE)).toEqual([]);
    const terrain = BASEMAP_PRESETS.terrain.style(DEFAULT_BASEMAP_OPTIONS) as StyleSpecification;
    expect(validateStyleMin(terrain)).toEqual([]);
    expect(terrain.sources.opentopomap).toMatchObject({ maxzoom: 17 });
  });

  it("offers every preset, Auto first", () => {
    expect(BASEMAP_PRESET_IDS).toEqual(["auto", "vidit-dark", "vidit-light", "streets", "terrain", "satellite"]);
    for (const id of BASEMAP_PRESET_IDS.filter((id) => id !== "auto")) {
      expect(BASEMAP_PRESETS[id as Exclude<BasemapPresetId, "auto">], id).toBeDefined();
    }
  });

  it("draws the 2016 Sentinel-2 cloudless mosaic, the CC BY year, to zoom 14 with its credit", () => {
    const satellite = BASEMAP_PRESETS.satellite.style(DEFAULT_BASEMAP_OPTIONS) as StyleSpecification;
    expect(validateStyleMin(satellite)).toEqual([]);
    const [source] = Object.values(satellite.sources) as { tiles: string[]; maxzoom: number; attribution: string }[];
    expect(source.tiles).toEqual([
      "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg",
    ]);
    expect(source.maxzoom).toBe(14);
    const credit = new DOMParser().parseFromString(source.attribution, "text/html").body.textContent ?? "";
    expect(credit).toContain(
      "Sentinel-2 cloudless 2016 by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016)",
    );
    expect(source.attribution).toContain('href="https://s2maps.eu"');
    expect(credit).toContain("CC BY 4.0");
  });
});

describe("aboveBasemap", () => {
  const OWN = ["imagery", "fires"];
  const overlays = new Set(["imagery", "fires", "grid", "sites", "clusters"]);
  const isOverlay = (id: string) => overlays.has(id);
  const apply = (stack: string[]) => {
    const move = aboveBasemap(stack, OWN, isOverlay);
    if (!move) return stack;
    let next = [...stack];
    for (const id of move.layers) {
      next = next.filter((other) => other !== id);
      const at = move.before === undefined ? next.length : next.indexOf(move.before);
      next.splice(at, 0, id);
    }
    return next;
  };

  it("moves a newly added layer under the overlays already on the map", () => {
    expect(apply(["land", "labels", "grid", "sites", "clusters", "fires"])).toEqual([
      "land",
      "labels",
      "fires",
      "grid",
      "sites",
      "clusters",
    ]);
  });

  it("keeps the imagery under the fire detections, whichever came first", () => {
    expect(apply(["land", "fires", "grid", "clusters", "imagery"])).toEqual([
      "land",
      "imagery",
      "fires",
      "grid",
      "clusters",
    ]);
  });

  it("asks for no move once the layers stand right above the basemap", () => {
    expect(aboveBasemap(["land", "imagery", "fires", "grid", "clusters"], OWN, isOverlay)).toBeNull();
    expect(aboveBasemap(["land", "labels"], OWN, isOverlay)).toBeNull();
  });

  it("puts the layers on top when no other overlay is on the map", () => {
    expect(aboveBasemap(["imagery", "land"], OWN, isOverlay)).toEqual({ layers: ["imagery"], before: undefined });
  });
});

describe("carryOverlays", () => {
  const keep = carryOverlays;
  const previous: StyleSpecification = {
    version: 8,
    projection: { type: "globe" },
    sources: {
      basemap: { type: "vector", url: "https://example.org/old" },
      points: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
      sites: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
    },
    layers: [
      { id: "old-land", type: "background" },
      { id: "site-fill", type: "fill", source: "sites" },
      { id: "clusters", type: "circle", source: "points" },
      { id: "cluster-count", type: "symbol", source: "points", layout: { "text-font": ["Montserrat Medium"] } },
    ],
  };
  const thirdParty: StyleSpecification = {
    version: 8,
    glyphs: "https://example.org/fonts/{fontstack}/{range}.pbf",
    sources: { basemap: { type: "vector", url: "https://example.org/new" } },
    layers: [
      { id: "land", type: "background" },
      { id: "city", type: "symbol", source: "basemap", "source-layer": "place", layout: { "text-font": ["Noto Sans Bold"] } },
      { id: "water", type: "symbol", source: "basemap", "source-layer": "water_name", layout: { "text-font": ["Noto Sans Italic"] } },
    ],
  };

  it("keeps the GeoJSON overlays and draws their layers above the incoming basemap", () => {
    const next = keep(previous, thirdParty);
    expect(next.layers.map((layer) => layer.id)).toEqual([
      "land",
      "city",
      "water",
      "site-fill",
      "clusters",
      "cluster-count",
    ]);
    expect(next.sources.points).toBe(previous.sources.points);
    expect(next.sources.sites).toBe(previous.sources.sites);
    expect(next.sources.basemap).toEqual(thirdParty.sources.basemap);
    expect(next.projection).toEqual({ type: "globe" });
  });

  it("keeps the tiled overlays and leaves the outgoing basemap's own sources", () => {
    const withImagery: StyleSpecification = {
      ...previous,
      sources: {
        ...previous.sources,
        opentopomap: { type: "raster", tiles: ["https://example.org/{z}/{x}/{y}.png"] },
        "relief-dem": { type: "raster-dem", tiles: ["https://example.org/dem/{z}/{x}/{y}.png"] },
        [DAILY_IMAGERY_SOURCE]: { type: "raster", tiles: ["https://example.org/imagery/{z}/{x}/{y}.jpg"] },
      },
      layers: [
        { id: "opentopomap", type: "raster", source: "opentopomap" },
        { id: "relief", type: "hillshade", source: "relief-dem" },
        { id: "daily-imagery", type: "raster", source: DAILY_IMAGERY_SOURCE },
        ...previous.layers.slice(1),
      ],
    };
    const next = keep(withImagery, thirdParty);
    expect(Object.keys(next.sources).sort()).toEqual(["basemap", DAILY_IMAGERY_SOURCE, "points", "sites"].sort());
    expect(next.layers.map((layer) => layer.id)).toEqual([
      "land",
      "city",
      "water",
      "daily-imagery",
      "site-fill",
      "clusters",
      "cluster-count",
    ]);
  });

  it("tells an overlay source from a basemap's own", () => {
    expect(isOverlaySource("points", "geojson")).toBe(true);
    expect(isOverlaySource(DAILY_IMAGERY_SOURCE, "raster")).toBe(true);
    expect(isOverlaySource("opentopomap", "raster")).toBe(false);
    expect(isOverlaySource("openmaptiles", "vector")).toBe(false);
  });

  it("resolves the vendored sprite path against the page", () => {
    const next = keep(undefined, VIDIT_STYLES.dark);
    expect(next.sprite).toBe(`${window.location.origin}/map-sprites/ofm`);
    expect(keep(undefined, thirdParty).sprite).toBeUndefined();
  });

  it("points every style at the Montserrat glyphs", () => {
    const next = keep(undefined, thirdParty);
    expect(next.glyphs).toBe("/map-glyphs/{fontstack}/{range}.pbf");
    const fonts = next.layers.map((layer) => (layer as Layer).layout?.["text-font"]);
    expect(fonts).toEqual([undefined, ["Montserrat Medium"], ["Montserrat Regular"]]);
  });
});
