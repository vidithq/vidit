import type { ExpressionSpecification, SymbolLayerSpecification } from "maplibre-gl";

import type { paletteMapColors } from "@/lib/palette";
import type { Brightness } from "./basemap";
import { CLUSTER_MAX_ZOOM } from "./stack";
import { TRIANGLE_RADIUS, besideOffsetPx } from "./triangle";

/** Layer ids of the event pins, shared with the site layers that must stay under them. The
 *  cluster layer is the lowest of them. */
export const CLUSTER_LAYER = "clusters";
export const STACK_LAYER = "stacks-circle";
export const POINT_LAYERS = ["points-selected", "points-circle"];

/** A site's triangle, alone or beside a cluster's circle, in the event points source. */
export const SITE_POINT_LAYER = "sites-point";
export const SITE_CLUSTER_LAYER = "sites-cluster";
export const TRIANGLE_ICON = "site-triangle";

/** From this zoom the map draws site zones; below it each site is a triangle in the clusters. */
export const ZONE_MIN_ZOOM = 10;

/** Every layer a tap can target (a query returns matches topmost first whatever the order here). */
export const TAP_TARGET_LAYERS = [CLUSTER_LAYER, SITE_CLUSTER_LAYER, STACK_LAYER, ...POINT_LAYERS];

const IS_SITE: ExpressionSpecification = ["==", ["get", "kind"], "site"];

/** The clustering of the event points source, which also holds the sites below `ZONE_MIN_ZOOM`:
 *  a cluster counts its events and its sites apart. */
export const CLUSTER_SOURCE = {
  cluster: true,
  clusterMaxZoom: CLUSTER_MAX_ZOOM,
  clusterRadius: 50,
  clusterProperties: {
    events: ["+", ["case", IS_SITE, 0, 1]],
    sites: ["+", ["case", IS_SITE, 1, 0]],
  } satisfies Record<string, [unknown, unknown]>,
} as const;

export const EVENT_COUNT: ExpressionSpecification = ["get", "events"];
export const SITE_COUNT: ExpressionSpecification = ["get", "sites"];
export const SITE_POINT_FILTER: ExpressionSpecification = ["all", ["!", ["has", "point_count"]], IS_SITE];

export const POINT_RADIUS = 6;
export const SELECTED_POINT_RADIUS = 7;
export const SELECTED_STROKE_WIDTH = 2;
export const CLUSTER_OPACITY = 0.85;

/** The halo around a selected marker: white on a dark basemap, a dark ring on a light one. */
export const SELECTED_STROKE: Record<Brightness, string> = { dark: "#ffffff", light: "#1a1a1a" };

/** `[from count, radius in px]` of a cluster's circle, and the triangle of the same count. */
const CLUSTER_TIERS: readonly (readonly [number, number])[] = [
  [0, 12],
  [50, 16],
  [200, 20],
  [1000, 26],
  [5000, 34],
  [10000, 42],
];
/** `[from count, text size in px]` of a cluster's count. */
const COUNT_TIERS: readonly (readonly [number, number])[] = [
  [0, 11],
  [1000, 13],
  [10000, 15],
];

function step<T>(input: ExpressionSpecification, tiers: readonly (readonly [number, T])[]): ExpressionSpecification {
  const [[, first], ...rest] = tiers;
  return ["step", input, first, ...rest.flat()] as unknown as ExpressionSpecification;
}

function tierValue(tiers: readonly (readonly [number, number])[], count: number): number {
  return tiers.filter(([from]) => count >= from).at(-1)![1];
}

export function clusterRadius(count: ExpressionSpecification): ExpressionSpecification {
  return step(count, CLUSTER_TIERS);
}

export function clusterColor(
  marker: ReturnType<typeof paletteMapColors>,
  count: ExpressionSpecification,
): ExpressionSpecification {
  return ["step", count, marker.base, 1000, marker.rampMid, 10000, marker.rampHigh];
}

export const CLUSTER_COUNT_COLOR = "#ffffff";

/** A count as supercluster abbreviates `point_count`: 1.2k from 1000, 12k from 10000. */
export function abbreviatedCount(count: ExpressionSpecification): ExpressionSpecification {
  return [
    "case",
    [">=", count, 10000],
    ["concat", ["to-string", ["round", ["/", count, 1000]]], "k"],
    [">=", count, 1000],
    ["concat", ["to-string", ["/", ["round", ["/", count, 100]], 10]], "k"],
    ["to-string", count],
  ];
}

export function clusterCountLayout(count: ExpressionSpecification) {
  return {
    "text-field": abbreviatedCount(count),
    "text-font": ["Montserrat Medium"],
    "text-size": step(count, COUNT_TIERS),
    // Skip symbol placement and its collision fade: a count must appear and vanish with its marker.
    "text-allow-overlap": true,
    "text-ignore-placement": true,
  } satisfies SymbolLayerSpecification["layout"];
}

/** Per event and site count tier, `value(eventRadius, siteRadius, siteTextSize)` as a literal:
 *  [0, 0] for a cluster of sites only. */
function besideCircle(value: (eventRadius: number, siteRadius: number, textSize: number) => [number, number]) {
  const bySites = (eventRadius: number) =>
    step(
      SITE_COUNT,
      CLUSTER_TIERS.map(([from, siteRadius]) => [
        from,
        ["literal", value(eventRadius, siteRadius, tierValue(COUNT_TIERS, from))],
      ]),
    );
  return step(EVENT_COUNT, [
    [0, ["literal", [0, 0]]],
    ...CLUSTER_TIERS.map(([from, eventRadius]) => [Math.max(from, 1), bySites(eventRadius)] as const),
  ]);
}

/** The site triangle of a cluster: its circle's colour ramp and size tiers, read on the site
 *  count, and right of the circle when the cluster holds events. */
export function siteClusterStyle(marker: ReturnType<typeof paletteMapColors>) {
  return {
    layout: {
      ...clusterCountLayout(SITE_COUNT),
      "icon-image": TRIANGLE_ICON,
      "icon-size": ["/", clusterRadius(SITE_COUNT), TRIANGLE_RADIUS],
      "icon-offset": besideCircle((e, s) => [(besideOffsetPx(e, s) * TRIANGLE_RADIUS) / s, 0]),
      "text-offset": besideCircle((e, s, size) => [besideOffsetPx(e, s) / size, 0]),
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
    paint: {
      "icon-color": clusterColor(marker, SITE_COUNT),
      "icon-opacity": CLUSTER_OPACITY,
      "text-color": CLUSTER_COUNT_COLOR,
    },
  } satisfies Pick<SymbolLayerSpecification, "layout" | "paint">;
}
