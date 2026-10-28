import type { ExpressionSpecification, SymbolLayerSpecification } from "maplibre-gl";

import type { paletteMapColors } from "@/lib/palette";
import type { Brightness } from "./basemap";
import { CLUSTER_MAX_ZOOM } from "./stack";

/** Layer ids of the event pins, shared with the site layers that must stay under them. The
 *  cluster layer is the lowest of them. */
export const CLUSTER_LAYER = "clusters";
export const STACK_LAYER = "stacks-circle";
export const POINT_LAYERS = ["points-selected", "points-circle"];

/** Every layer a tap can target (a query returns matches topmost first whatever the order here). */
export const TAP_TARGET_LAYERS = [CLUSTER_LAYER, STACK_LAYER, ...POINT_LAYERS];

/** The clustering of a marker source: the event points and the sites each cluster on their own. */
export const CLUSTER_SOURCE = {
  cluster: true,
  clusterMaxZoom: CLUSTER_MAX_ZOOM,
  clusterRadius: 50,
} as const;

export const POINT_RADIUS = 6;
export const SELECTED_POINT_RADIUS = 7;
export const SELECTED_STROKE_WIDTH = 2;
export const CLUSTER_OPACITY = 0.85;

/** The halo around a selected marker: white on a dark basemap, a dark ring on a light one. */
export const SELECTED_STROKE: Record<Brightness, string> = { dark: "#ffffff", light: "#1a1a1a" };

/** A cluster's size in px by its count: the radius of an event cluster's circle. */
export const CLUSTER_RADIUS: ExpressionSpecification = [
  "step",
  ["get", "point_count"],
  12,
  50, 16,
  200, 20,
  1000, 26,
  5000, 34,
  10000, 42,
];

export function clusterColor(marker: ReturnType<typeof paletteMapColors>): ExpressionSpecification {
  return ["step", ["get", "point_count"], marker.base, 1000, marker.rampMid, 10000, marker.rampHigh];
}

export const CLUSTER_COUNT_COLOR = "#ffffff";

export const CLUSTER_COUNT_LAYOUT = {
  "text-field": "{point_count_abbreviated}",
  "text-font": ["Montserrat Medium"],
  "text-size": ["step", ["get", "point_count"], 11, 1000, 13, 10000, 15],
  // Skip symbol placement and its collision fade: a count must appear and vanish with its marker.
  "text-allow-overlap": true,
  "text-ignore-placement": true,
} satisfies SymbolLayerSpecification["layout"];
