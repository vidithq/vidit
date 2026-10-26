import type {
  ExpressionSpecification,
  FilterSpecification,
  LayerSpecification,
  StyleSpecification,
} from "maplibre-gl";

import { MAP_LAYER_COLORS } from "@/lib/palette";
import type { ThemeId } from "@/lib/theme";

import viditDark from "./styles/vidit-dark.json";
import viditLight from "./styles/vidit-light.json";

export type Brightness = "dark" | "light";

/** The Vidit styles, forked from OpenFreeMap's dark and Positron (licence in `styles/LICENSE`).
 *  Each layer the builder adjusts carries a `vidit:role` in its metadata. */
export const VIDIT_STYLES: Record<Brightness, StyleSpecification> = {
  dark: viditDark as unknown as StyleSpecification,
  light: viditLight as unknown as StyleSpecification,
};

type LayerRole =
  | "place-label"
  | "label"
  | "road"
  | "minor-road"
  | "road-label"
  | "region-border"
  | "disputed-border"
  | "building"
  | "military-airport";

const ROAD_ROLES: ReadonlySet<LayerRole> = new Set(["road", "minor-road", "road-label"]);

export type LabelLanguage = "latin" | "local" | "both";
export type LabelDensity = "sparse" | "normal";

export interface BasemapOptions {
  language: LabelLanguage;
  density: LabelDensity;
  regionBorders: boolean;
  roads: boolean;
  buildings: boolean;
  militaryAndAirports: boolean;
  /** Dashed, a disputed country border reads apart from a settled one; solid, it reads like one. */
  disputedDashed: boolean;
}

export const DEFAULT_BASEMAP_OPTIONS: BasemapOptions = {
  language: "latin",
  density: "sparse",
  regionBorders: false,
  roads: true,
  buildings: true,
  militaryAndAirports: true,
  disputedDashed: true,
};

// Below zoom 5 a sparse map labels countries and capitals only. At 5 one country fills a laptop
// screen and its cities become the useful read; below it the reader is looking at a continent or
// the globe, where city names crowd the event points. Filters see integer zooms only, so the
// threshold is a whole number.
export const LOW_ZOOM = 5;
const TOWN_ZOOM = 7;
const VILLAGE_ZOOM = 10;
const MINOR_ZOOM = 12;

// In OpenMapTiles, `capital: 2` marks a national capital.
const SPARSE_PLACE_FILTER: ExpressionSpecification = [
  "any",
  ["==", ["get", "class"], "country"],
  ["==", ["get", "capital"], 2],
  [
    ">=",
    ["zoom"],
    [
      "match",
      ["get", "class"],
      "city",
      LOW_ZOOM,
      ["town", "state"],
      TOWN_ZOOM,
      "village",
      VILLAGE_ZOOM,
      MINOR_ZOOM,
    ],
  ],
];

const SPARSE_MIN_ZOOM: Partial<Record<LayerRole, number>> = {
  label: LOW_ZOOM,
  road: LOW_ZOOM,
  "road-label": LOW_ZOOM,
  "minor-road": MINOR_ZOOM,
};

const NAME: ExpressionSpecification = ["get", "name"];
const LATIN_NAME: ExpressionSpecification = ["coalesce", ["get", "name:latin"], NAME];

// MapLibre cannot shape some scripts (Indic, and right-to-left without its RTL plugin): such a
// name falls back to its Latin form instead of drawing broken text.
function labelText(language: LabelLanguage, separator: string): ExpressionSpecification {
  switch (language) {
    case "latin":
      return LATIN_NAME;
    case "local":
      return ["case", ["all", ["has", "name"], ["is-supported-script", NAME]], NAME, LATIN_NAME];
    case "both":
      return [
        "case",
        ["all", ["has", "name:nonlatin"], ["is-supported-script", ["get", "name:nonlatin"]]],
        ["concat", ["get", "name:latin"], separator, ["get", "name:nonlatin"]],
        LATIN_NAME,
      ];
  }
}

type AdjustableLayer = LayerSpecification & {
  "source-layer"?: string;
  filter?: FilterSpecification;
  layout?: Record<string, unknown>;
  paint?: Record<string, unknown>;
  metadata?: unknown;
};

function roleOf(layer: AdjustableLayer): LayerRole | undefined {
  const metadata = layer.metadata as Record<string, unknown> | undefined;
  return metadata?.["vidit:role"] as LayerRole | undefined;
}

function adjustLayer(layer: AdjustableLayer, options: BasemapOptions): LayerSpecification {
  const role = roleOf(layer);
  if (!role) return layer;
  const next: AdjustableLayer = { ...layer, layout: { ...layer.layout } };
  const layout = next.layout as Record<string, unknown>;

  const hidden =
    (role === "region-border" && !options.regionBorders) ||
    (ROAD_ROLES.has(role) && !options.roads) ||
    (role === "building" && !options.buildings) ||
    (role === "military-airport" && !options.militaryAndAirports);
  if (hidden) layout.visibility = "none";

  if (role === "disputed-border" && !options.disputedDashed) {
    const { "line-dasharray": _dash, ...solid } = next.paint ?? {};
    next.paint = solid;
  }

  if (JSON.stringify(layout["text-field"] ?? null).includes('"name')) {
    const separator = layout["symbol-placement"] === "line" ? " " : "\n";
    layout["text-field"] = labelText(options.language, separator);
  }

  if (options.density === "sparse") {
    if (role === "place-label") {
      next.filter = (
        next.filter ? ["all", next.filter, SPARSE_PLACE_FILTER] : SPARSE_PLACE_FILTER
      ) as FilterSpecification;
    }
    const floor = SPARSE_MIN_ZOOM[role];
    if (floor !== undefined) next.minzoom = Math.max(next.minzoom ?? 0, floor);
  }
  return next;
}

const LINES: ExpressionSpecification = [
  "match",
  ["geometry-type"],
  ["LineString", "MultiLineString"],
  true,
  false,
];

/** Military areas (`landuse` class `military`, from zoom 10 in the tiles) and airports (the
 *  `aeroway` aerodrome area, runways and taxiways) drawn over the land, in colours of their own. */
function militaryAirportLayers(brightness: Brightness): LayerSpecification[] {
  const { military, airport } = MAP_LAYER_COLORS[brightness];
  const source = { source: "openmaptiles", metadata: { "vidit:role": "military-airport" } };
  const isMilitary: FilterSpecification = ["==", ["get", "class"], "military"];
  const isAerodrome: FilterSpecification = ["==", ["get", "class"], "aerodrome"];
  const outlineWidth: ExpressionSpecification = ["interpolate", ["linear"], ["zoom"], 10, 0.75, 16, 1.5];
  return [
    {
      ...source,
      id: "vidit-military-fill",
      type: "fill",
      "source-layer": "landuse",
      filter: isMilitary,
      paint: { "fill-color": military, "fill-opacity": 0.12 },
    },
    {
      ...source,
      id: "vidit-military-outline",
      type: "line",
      "source-layer": "landuse",
      filter: isMilitary,
      paint: { "line-color": military, "line-opacity": 0.7, "line-width": outlineWidth },
    },
    {
      ...source,
      id: "vidit-airport-fill",
      type: "fill",
      "source-layer": "aeroway",
      filter: isAerodrome,
      paint: { "fill-color": airport, "fill-opacity": 0.12 },
    },
    {
      ...source,
      id: "vidit-airport-outline",
      type: "line",
      "source-layer": "aeroway",
      filter: isAerodrome,
      paint: { "line-color": airport, "line-opacity": 0.7, "line-width": outlineWidth },
    },
    {
      ...source,
      id: "vidit-runway",
      type: "line",
      "source-layer": "aeroway",
      filter: ["all", LINES, ["match", ["get", "class"], ["runway", "taxiway"], true, false]],
      layout: { "line-cap": "round" },
      paint: {
        "line-color": airport,
        "line-opacity": 0.85,
        "line-width": [
          "interpolate",
          ["exponential", 1.5],
          ["zoom"],
          10,
          ["match", ["get", "class"], "runway", 1.5, 0.5],
          17,
          ["match", ["get", "class"], "runway", 16, 4],
        ],
      },
    },
  ];
}

/** A Vidit style with the reader's options applied. Pure: the same inputs give an equal style,
 *  so MapLibre's style diff turns an option change into `setLayoutProperty`, `setPaintProperty`,
 *  `setFilter` and `setLayerZoomRange` calls on the live map. */
export function buildViditStyle(brightness: Brightness, options: BasemapOptions): StyleSpecification {
  const base = VIDIT_STYLES[brightness];
  const layers = [...base.layers];
  // Above the style's own aeroway layers, under its roads and labels.
  let at = 0;
  layers.forEach((layer, i) => {
    if ((layer as AdjustableLayer)["source-layer"] === "aeroway") at = i + 1;
  });
  layers.splice(at, 0, ...militaryAirportLayers(brightness));
  return {
    ...base,
    layers: layers.map((layer) => adjustLayer(layer as AdjustableLayer, options)),
  };
}

const GLYPHS = "/map-glyphs/{fontstack}/{range}.pbf";

/** What the map mounts with: nothing to fetch, and a glyphs URL so the count labels can attach
 *  before the basemap arrives. */
export const BLANK_STYLE: StyleSpecification = {
  version: 8,
  glyphs: GLYPHS,
  sources: {},
  layers: [],
};

// Raster tiles stop at 17; MapLibre scales the last level past it.
const TERRAIN_STYLE: StyleSpecification = {
  version: 8,
  name: "OpenTopoMap",
  glyphs: GLYPHS,
  sources: {
    opentopomap: {
      type: "raster",
      tiles: ["a", "b", "c"].map((s) => `https://${s}.tile.opentopomap.org/{z}/{x}/{y}.png`),
      tileSize: 256,
      maxzoom: 17,
      attribution:
        'Map data: &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors, <a href="http://viewfinderpanoramas.org" target="_blank">SRTM</a> | Map style: &copy; <a href="https://opentopomap.org" target="_blank">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank">CC-BY-SA</a>)',
    },
  },
  layers: [{ id: "opentopomap", type: "raster", source: "opentopomap" }],
};

export const BASEMAP_PRESET_IDS = ["auto", "vidit-dark", "vidit-light", "streets", "terrain"] as const;
export type BasemapPresetId = (typeof BASEMAP_PRESET_IDS)[number];
type ConcretePresetId = Exclude<BasemapPresetId, "auto">;

interface BasemapPreset {
  brightness: Brightness;
  /** Whether the reader's options apply. Third-party styles draw as published. */
  adjustable: boolean;
  style: (options: BasemapOptions) => StyleSpecification | string;
}

export const BASEMAP_PRESETS: Record<ConcretePresetId, BasemapPreset> = {
  "vidit-dark": {
    brightness: "dark",
    adjustable: true,
    style: (options) => buildViditStyle("dark", options),
  },
  "vidit-light": {
    brightness: "light",
    adjustable: true,
    style: (options) => buildViditStyle("light", options),
  },
  streets: {
    brightness: "light",
    adjustable: false,
    style: () => "https://tiles.openfreemap.org/styles/liberty",
  },
  terrain: { brightness: "light", adjustable: false, style: () => TERRAIN_STYLE },
};

/** Auto follows the theme onto the Vidit style of the same brightness. */
export function resolvePreset(id: BasemapPresetId, theme: ThemeId): ConcretePresetId {
  if (id !== "auto") return id;
  return theme === "light" ? "vidit-light" : "vidit-dark";
}

function viditFont(font: string): string {
  return /medium|semibold|bold|black/i.test(font) ? "Montserrat Medium" : "Montserrat Regular";
}

/** Points a style at the Montserrat glyphs: a third-party style's labels, and the map's own count
 *  labels on top of it, then draw from the one glyph server a style can name. */
function withViditGlyphs(style: StyleSpecification): StyleSpecification {
  return {
    ...style,
    glyphs: GLYPHS,
    layers: style.layers.map((layer) => {
      const fonts = (layer.layout as Record<string, unknown> | undefined)?.["text-font"];
      if (!Array.isArray(fonts) || fonts.length === 0) return layer;
      return {
        ...layer,
        layout: { ...layer.layout, "text-font": [viditFont(String(fonts[0]))] },
      } as LayerSpecification;
    }),
  };
}

/** The `transformStyle` of a basemap swap. The app's overlays (event points, sites, a drawn zone)
 *  are its GeoJSON sources, which no basemap ships: it keeps them and their layers from the
 *  outgoing style, drawn above the incoming basemap in their order, so they never leave the map,
 *  and keeps the projection, which the incoming style does not set. */
export function carryOverlays(
  previous: StyleSpecification | undefined,
  next: StyleSpecification,
): StyleSpecification {
  const style = withViditGlyphs(next);
  if (!previous) return style;
  const overlays = Object.fromEntries(
    Object.entries(previous.sources).filter(
      ([id, source]) => source.type === "geojson" && !(id in style.sources),
    ),
  );
  return {
    ...style,
    projection: previous.projection ?? style.projection,
    sources: { ...style.sources, ...overlays },
    layers: [
      ...style.layers,
      ...previous.layers.filter((layer) => "source" in layer && layer.source in overlays),
    ],
  };
}
