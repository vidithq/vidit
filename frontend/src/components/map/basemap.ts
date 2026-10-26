import type {
  ExpressionSpecification,
  FilterSpecification,
  LayerSpecification,
  StyleSpecification,
} from "maplibre-gl";

import type { ThemeId } from "@/lib/theme";

import viditDark from "./styles/vidit-dark.json";
import viditLight from "./styles/vidit-light.json";

/** The Vidit styles, forked from OpenFreeMap's dark and Positron (licence in `styles/LICENSE`).
 *  Each layer the builder adjusts carries a `vidit:role` in its metadata. */
export const VIDIT_STYLES = {
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
  | "building";

const ROAD_ROLES: ReadonlySet<LayerRole> = new Set(["road", "minor-road", "road-label"]);

export type LabelLanguage = "latin" | "local" | "both";
export type LabelDensity = "sparse" | "normal";

export interface BasemapOptions {
  language: LabelLanguage;
  density: LabelDensity;
  regionBorders: boolean;
  roads: boolean;
  buildings: boolean;
}

export const DEFAULT_BASEMAP_OPTIONS: BasemapOptions = {
  language: "latin",
  density: "sparse",
  regionBorders: false,
  roads: true,
  buildings: true,
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
  filter?: FilterSpecification;
  layout?: Record<string, unknown>;
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
    (role === "building" && !options.buildings);
  if (hidden) layout.visibility = "none";

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

/** A Vidit style with the reader's options applied. Pure: the same inputs give an equal style,
 *  so MapLibre's style diff turns an option change into `setLayoutProperty`, `setFilter` and
 *  `setLayerZoomRange` calls on the live map. */
export function buildViditStyle(
  base: StyleSpecification,
  options: BasemapOptions,
): StyleSpecification {
  return {
    ...base,
    layers: base.layers.map((layer) => adjustLayer(layer as AdjustableLayer, options)),
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

export type Brightness = "dark" | "light";

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
    style: (options) => buildViditStyle(VIDIT_STYLES.dark, options),
  },
  "vidit-light": {
    brightness: "light",
    adjustable: true,
    style: (options) => buildViditStyle(VIDIT_STYLES.light, options),
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
