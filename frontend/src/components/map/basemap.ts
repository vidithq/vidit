import type {
  ExpressionSpecification,
  FilterSpecification,
  LayerSpecification,
  StyleSpecification,
} from "maplibre-gl";

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
  | "region-border";

const ROAD_ROLES: ReadonlySet<LayerRole> = new Set(["road", "minor-road", "road-label"]);

export type LabelLanguage = "latin" | "local" | "both";
export type LabelDensity = "sparse" | "normal";

export interface BasemapOptions {
  language: LabelLanguage;
  density: LabelDensity;
  regionBorders: boolean;
  roads: boolean;
}

export const DEFAULT_BASEMAP_OPTIONS: BasemapOptions = {
  language: "latin",
  density: "sparse",
  regionBorders: false,
  roads: true,
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
    (ROAD_ROLES.has(role) && !options.roads);
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
