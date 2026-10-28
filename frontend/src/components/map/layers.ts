import type { ExpressionSpecification, SymbolLayerSpecification } from "maplibre-gl";

import type { paletteMapColors } from "@/lib/palette";
import type { Zone } from "@/lib/sites";
import type { Brightness } from "./basemap";
import { CLUSTER_MAX_ZOOM } from "./stack";

/** Layer ids of the event pins, shared with the site layers that must stay under them. The
 *  cluster layer is the lowest of them. */
export const CLUSTER_LAYER = "clusters";
export const STACK_LAYER = "stacks-circle";
export const POINT_LAYERS = ["points-selected", "points-circle"];

/** A lone site's ring, and the ring around a cluster that holds a site, in the event points
 *  source. */
export const SITE_POINT_LAYER = "sites-point";
export const SITE_RING_LAYER = "sites-cluster-ring";

/** Below this zoom each site is a point in the event clusters; from it the zones alone stand for
 *  the sites. */
export const SITE_POINT_MAX_ZOOM = 10;

/** Every layer a tap can target (a query returns matches topmost first whatever the order here). */
export const TAP_TARGET_LAYERS = [CLUSTER_LAYER, SITE_RING_LAYER, STACK_LAYER, ...POINT_LAYERS];

const IS_SITE: ExpressionSpecification = ["==", ["get", "kind"], "site"];

/** The clustering of the event points source, which also holds the sites below
 *  `SITE_POINT_MAX_ZOOM`: a cluster counts its sites apart from its total. */
export const CLUSTER_SOURCE = {
  cluster: true,
  clusterMaxZoom: CLUSTER_MAX_ZOOM,
  clusterRadius: 50,
  clusterProperties: {
    sites: ["+", ["case", IS_SITE, 1, 0]],
  } satisfies Record<string, [unknown, unknown]>,
} as const;

export const POINT_COUNT: ExpressionSpecification = ["get", "point_count"];
export const SITE_COUNT: ExpressionSpecification = ["get", "sites"];
export const SITE_POINT_FILTER: ExpressionSpecification = ["all", ["!", ["has", "point_count"]], IS_SITE];

export const POINT_RADIUS = 6;
export const SELECTED_POINT_RADIUS = 7;
export const SELECTED_STROKE_WIDTH = 2;
export const CLUSTER_OPACITY = 0.85;

/** The halo around a selected marker: white on a dark basemap, a dark ring on a light one. */
export const SELECTED_STROKE: Record<Brightness, string> = { dark: "#ffffff", light: "#1a1a1a" };

/** `[from count, radius in px]` of a cluster's circle. */
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

/** The ring around a cluster that holds a site: its gap from the circle and its width, in px. */
export const SITE_RING_GAP_PX = 3;
export const SITE_RING_WIDTH_PX = 2;
/** The fill opacity of a zone and of a lone site's ring. */
export const SITE_ZONE_FILL_OPACITY = 0.12;
/** A lone site's ring is never smaller than this radius, in px. */
export const SITE_RING_MIN_RADIUS_PX = 7;
/** A lone site's ring fades out once its zone is this much wider than the smallest ring. */
const SITE_RING_FADE_FACTOR = 1.5;
/** The width of the world at zoom 0, in px: MapLibre's 512 px tiles. */
const WORLD_PX = 512;

function mercatorPx([lng, lat]: readonly number[]): [number, number] {
  const phi = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  return [
    ((lng + 180) / 360) * WORLD_PX,
    ((1 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / Math.PI) / 2) * WORLD_PX,
  ];
}

/** The radius at zoom 0, in px, of the smallest circle around `centroid` that holds `zone`: at
 *  zoom z it is `2 ** z` times larger. */
export function zoneRadiusAtZoom0(zone: Zone, centroid: { lat: number; lng: number }): number {
  const [cx, cy] = mercatorPx([centroid.lng, centroid.lat]);
  let farthest = 0;
  for (const ring of zone.coordinates) {
    for (const vertex of ring) {
      const [x, y] = mercatorPx(vertex);
      farthest = Math.max(farthest, Math.hypot(x - cx, y - cy));
    }
  }
  return farthest;
}

const ZONE_RADIUS = ["get", "zone_radius"] satisfies ExpressionSpecification;
const RING_ZOOMS = Array.from({ length: SITE_POINT_MAX_ZOOM + 1 }, (_, zoom) => zoom);

/** A zoom curve with one stop per integer zoom up to `SITE_POINT_MAX_ZOOM`, `output(zoneRadiusPx)`
 *  at each: a `zoom` expression is legal only as the input of a top-level `interpolate`. */
function perZoom(
  curve: ["linear"] | ["exponential", number],
  output: (zoneRadiusPx: ExpressionSpecification) => unknown,
): ExpressionSpecification {
  return [
    "interpolate",
    curve,
    ["zoom"],
    ...RING_ZOOMS.flatMap((zoom) => [zoom, output(["*", ZONE_RADIUS, 2 ** zoom])]),
  ] as unknown as ExpressionSpecification;
}

/** A lone site's ring radius: its zone's, never under `SITE_RING_MIN_RADIUS_PX`. */
export const LONE_SITE_RING_RADIUS = perZoom(["exponential", 2], (zoneRadiusPx) => [
  "max",
  SITE_RING_MIN_RADIUS_PX,
  zoneRadiusPx,
]);

/** `opacity` while a lone site's zone is too small to read, 0 once the zone stands for it. */
export function loneSiteRingOpacity(opacity: number): ExpressionSpecification {
  return perZoom(["linear"], (zoneRadiusPx) => [
    "case",
    ["<", zoneRadiusPx, SITE_RING_MIN_RADIUS_PX * SITE_RING_FADE_FACTOR],
    opacity,
    0,
  ]);
}
