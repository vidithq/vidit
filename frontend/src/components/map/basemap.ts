import type {
  ExpressionSpecification,
  FilterSpecification,
  LayerSpecification,
  RasterSourceSpecification,
  SourceSpecification,
  StyleSpecification,
} from "maplibre-gl";

import { MAP_LAYER_COLORS } from "@/lib/palette";
import type { ThemeId } from "@/lib/theme";

import { DAILY_IMAGERY_SOURCE } from "./gibs";
import type { MapAssets } from "./mapAssets";
import viditDark from "./styles/vidit-dark.json";
import viditLight from "./styles/vidit-light.json";
import viditStreets from "./styles/vidit-streets.json";

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
  | "military-airport"
  | "relief";

const ROAD_ROLES: ReadonlySet<LayerRole> = new Set(["road", "minor-road", "road-label"]);

export const LABEL_LANGUAGES = ["latin", "local", "both"] as const;
export type LabelLanguage = (typeof LABEL_LANGUAGES)[number];
export const LABEL_DENSITIES = ["sparse", "normal"] as const;
export type LabelDensity = (typeof LABEL_DENSITIES)[number];

export interface BasemapOptions {
  language: LabelLanguage;
  density: LabelDensity;
  regionBorders: boolean;
  roads: boolean;
  buildings: boolean;
  militaryAndAirports: boolean;
  relief: boolean;
  /** Dashed, a disputed country border reads apart from a settled one; solid, it reads like one. */
  disputedDashed: boolean;
}

export const DEFAULT_BASEMAP_OPTIONS: BasemapOptions = {
  language: "latin",
  density: "sparse",
  regionBorders: false,
  roads: true,
  buildings: true,
  militaryAndAirports: false,
  relief: false,
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
    (role === "military-airport" && !options.militaryAndAirports) ||
    (role === "relief" && !options.relief);
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
  const source = { source: VECTOR_SOURCE, metadata: { "vidit:role": "military-airport" } };
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

const VECTOR_SOURCE = "openmaptiles";
const NATURAL_EARTH_SOURCE = "ne2_shaded";
const RELIEF_SOURCE = "relief-dem";

// The elevation tiles stop at 15; MapLibre scales the last level past it.
const RELIEF_SOURCE_SPEC: SourceSpecification = {
  type: "raster-dem",
  tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
  encoding: "terrarium",
  tileSize: 256,
  maxzoom: 15,
  attribution:
    '<a href="https://registry.opendata.aws/terrain-tiles" target="_blank">Terrain Tiles</a>: USGS, NOAA, Copernicus EU-DEM and <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank">others</a>',
};

const LAND_SOURCE_LAYERS: ReadonlySet<string> = new Set(["water", "landcover", "landuse", "park"]);

function reliefLayer(brightness: Brightness): LayerSpecification {
  const { reliefShadow, reliefHighlight, reliefAccent } = MAP_LAYER_COLORS[brightness];
  return {
    id: "vidit-relief",
    type: "hillshade",
    source: RELIEF_SOURCE,
    metadata: { "vidit:role": "relief" },
    paint: {
      "hillshade-exaggeration": 0.35,
      "hillshade-shadow-color": reliefShadow,
      "hillshade-highlight-color": reliefHighlight,
      "hillshade-accent-color": reliefAccent,
    },
  };
}

/** A Vidit style with the reader's options applied. Pure: the same inputs give an equal style,
 *  so MapLibre's style diff turns an option change into `setLayoutProperty`, `setPaintProperty`,
 *  `setFilter` and `setLayerZoomRange` calls on the live map. */
export function buildViditStyle(brightness: Brightness, options: BasemapOptions): StyleSpecification {
  const base = VIDIT_STYLES[brightness];
  const layers = [...base.layers];
  const after = (sourceLayers: ReadonlySet<string>) => {
    let at = 0;
    layers.forEach((layer, i) => {
      if (sourceLayers.has((layer as AdjustableLayer)["source-layer"] ?? "")) at = i + 1;
    });
    return at;
  };
  // Above the water and land fills, under everything drawn on the land.
  layers.splice(after(LAND_SOURCE_LAYERS), 0, reliefLayer(brightness));
  // Above the style's own aeroway layers, under its roads and labels.
  layers.splice(after(new Set(["aeroway"])), 0, ...militaryAirportLayers(brightness));
  return {
    ...base,
    sources: { ...base.sources, [RELIEF_SOURCE]: RELIEF_SOURCE_SPEC },
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

/** A basemap of one raster source. MapLibre scales the source's last level past its `maxzoom`. */
function rasterStyle(name: string, id: string, source: RasterSourceSpecification): StyleSpecification {
  return {
    version: 8,
    name,
    glyphs: GLYPHS,
    sources: { [id]: source },
    layers: [{ id, type: "raster", source: id }],
  };
}

const TERRAIN_STYLE = rasterStyle("OpenTopoMap", "opentopomap", {
  type: "raster",
  tiles: ["a", "b", "c"].map((s) => `https://${s}.tile.opentopomap.org/{z}/{x}/{y}.png`),
  tileSize: 256,
  maxzoom: 17,
  attribution:
    'Map data: &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors, <a href="http://viewfinderpanoramas.org" target="_blank">SRTM</a> | Map style: &copy; <a href="https://opentopomap.org" target="_blank">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank">CC-BY-SA</a>)',
});

// The 2016 mosaic is CC BY; EOX licenses the 2018 and later ones for non-commercial use only. The
// 10 m data adds no detail past zoom 14, where EOX serves enlarged copies.
const SATELLITE_STYLE = rasterStyle("Sentinel-2 cloudless 2016", "s2cloudless-2016", {
  type: "raster",
  tiles: ["https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg"],
  tileSize: 256,
  maxzoom: 14,
  attribution:
    '<a href="https://s2maps.eu" target="_blank">Sentinel-2 cloudless 2016</a> by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016), <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank">CC BY 4.0</a>',
});

export const BASEMAP_PRESET_IDS = [
  "auto",
  "vidit-dark",
  "vidit-light",
  "streets",
  "terrain",
  "satellite",
] as const;
export type BasemapPresetId = (typeof BASEMAP_PRESET_IDS)[number];
type ConcretePresetId = Exclude<BasemapPresetId, "auto">;

interface BasemapPreset {
  brightness: Brightness;
  /** Whether the reader's options apply. Third-party styles draw as published. */
  adjustable: boolean;
  style: (options: BasemapOptions) => StyleSpecification;
}

/** OpenFreeMap Liberty, forked to read the self-hosted files too (licence in `styles/LICENSE`). */
const STREETS_STYLE = viditStreets as unknown as StyleSpecification;

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
    style: () => STREETS_STYLE,
  },
  terrain: { brightness: "light", adjustable: false, style: () => TERRAIN_STYLE },
  satellite: { brightness: "dark", adjustable: false, style: () => SATELLITE_STYLE },
};

/** Points a basemap's OpenFreeMap tiles, Natural Earth relief, elevation and sprite at the
 *  self-hosted files. The archive's header sets each source's zoom range, so the style's own
 *  `maxzoom` goes: the relief archive stops below the public elevation tiles. */
export function applyMapAssets(style: StyleSpecification, assets: MapAssets | null): StyleSpecification {
  if (!assets) return style;
  const urls: Record<string, string> = {
    [VECTOR_SOURCE]: assets.planet,
    [NATURAL_EARTH_SOURCE]: assets.naturalEarth,
    [RELIEF_SOURCE]: assets.relief,
  };
  const sources = Object.fromEntries(
    Object.entries(style.sources).map(([id, source]) => {
      if (!(id in urls) || !("tiles" in source || "url" in source)) return [id, source];
      const { tiles: _tiles, url: _url, maxzoom: _maxzoom, ...rest } = source as SourceSpecification & {
        tiles?: string[];
        url?: string;
        maxzoom?: number;
      };
      return [id, { ...rest, url: urls[id] }];
    }),
  ) as StyleSpecification["sources"];
  return { ...style, sources, ...(style.sprite ? { sprite: assets.sprite } : {}) };
}

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

/** MapLibre loads a sprite only from an absolute URL, and the Vidit styles name the served one by
 *  its path. */
function withAbsoluteSprite(style: StyleSpecification): StyleSpecification {
  if (typeof style.sprite !== "string" || !style.sprite.startsWith("/")) return style;
  return { ...style, sprite: new URL(style.sprite, window.location.origin).href };
}

/** Whether a map source is one of the app's overlays rather than part of a basemap: every GeoJSON
 *  source (event points, sites, a drawn zone, the coordinate grid, fire detections), which no
 *  basemap ships, and the tiled overlays named here. */
export function isOverlaySource(id: string, type: string): boolean {
  return type === "geojson" || id === DAILY_IMAGERY_SOURCE;
}

/** Where to move the `own` layers so they draw, in their order, right above the basemap: before
 *  the first other overlay layer, or on top (`before` undefined) when there is none. Null when
 *  they already stand there. */
export function aboveBasemap(
  stack: readonly string[],
  own: readonly string[],
  isOverlayLayer: (id: string) => boolean,
): { layers: string[]; before: string | undefined } | null {
  const layers = own.filter((id) => stack.includes(id));
  const rest = stack.filter((id) => !layers.includes(id));
  const before = rest.find(isOverlayLayer);
  const at = before === undefined ? rest.length : rest.indexOf(before);
  const wanted = [...rest.slice(0, at), ...layers, ...rest.slice(at)];
  return wanted.every((id, i) => stack[i] === id) ? null : { layers, before };
}

/** The `transformStyle` of a basemap swap. It keeps the overlay sources (`isOverlaySource`) and
 *  their layers from the outgoing style, drawn above the incoming basemap in their order, so they
 *  never leave the map, and keeps the projection, which the incoming style does not set. */
export function carryOverlays(
  previous: StyleSpecification | undefined,
  next: StyleSpecification,
): StyleSpecification {
  const style = withViditGlyphs(withAbsoluteSprite(next));
  if (!previous) return style;
  const overlays = Object.fromEntries(
    Object.entries(previous.sources).filter(
      ([id, source]) => isOverlaySource(id, source.type) && !(id in style.sources),
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
