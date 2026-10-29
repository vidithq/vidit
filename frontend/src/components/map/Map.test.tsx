import type { ReactNode } from "react";
import { render } from "@testing-library/react";
import { createExpression, featureFilter, validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import type { FeatureCollection } from "geojson";
import { beforeEach, describe, expect, it, vi } from "vitest";

// No map in jsdom: `<Source>` mounts its children, `<Layer>` records its props in mount order (the
// order the style stacks them), and the map is a fake whose every method is a no-op.
type Props = Record<string, unknown>;
const layers: Props[] = [];
const sources: Props[] = [];
const methods: Record<string, unknown> = {
  getCanvas: () => document.createElement("canvas"),
  getLayer: () => undefined,
  getLayersOrder: () => [],
};
const fakeMap: object = new Proxy(methods, {
  get: (target, key: string) => (key === "getMap" ? () => fakeMap : (target[key] ?? (() => undefined))),
});
vi.mock("react-map-gl/maplibre", () => ({
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Source: ({ children, ...props }: Props & { children?: ReactNode }) => {
    sources.push(props);
    return <>{children}</>;
  },
  Layer: (props: Props) => {
    layers.push(props);
    return null;
  },
  NavigationControl: () => null,
  AttributionControl: () => null,
  useControl: () => null,
  useMap: () => ({ current: fakeMap }),
}));
vi.mock("./webgl", () => ({ guardedMaplibre: {}, supportsMaplibreWebGL: () => true, WebGLUnavailableError: Error }));
vi.mock("./maplibreWorker", () => ({}));

import Map from "./Map";
import { SiteLayers, type MapSite } from "./SiteLayers";
import {
  CLUSTER_LAYER,
  POINT_LAYERS,
  SITE_POINT_LAYER,
  SITE_RING_GAP_PX,
  SITE_RING_LAYER,
  SITE_POINT_MAX_ZOOM,
  SITE_RING_RADIUS_PX,
  STACK_LAYER,
  clusterRadius,
} from "./layers";
import type { MapPoint } from "@/types";

/** A square zone `halfDeg` degrees from its centroid on each side. */
function site(id: string, lat: number, lng: number, halfDeg: number): MapSite {
  const ring: [number, number][] = [
    [lng - halfDeg, lat - halfDeg],
    [lng + halfDeg, lat - halfDeg],
    [lng + halfDeg, lat + halfDeg],
    [lng - halfDeg, lat + halfDeg],
    [lng - halfDeg, lat - halfDeg],
  ];
  return { id, centroid: { lat, lng }, zone: { type: "Polygon", coordinates: [ring] } };
}

const DEPOT = site("depot", 48.5, 37.8, 0.002);
const AIRBASE = site("airbase", 47.1, 33.4, 0.05);
const EVENT_ID = "e1";
const EVENT: MapPoint = [EVENT_ID, 48.6, 37.9, null, "2026-10-01", 0];

function renderMap() {
  const sites = [DEPOT, AIRBASE];
  render(
    <Map points={[EVENT]} sites={sites} zoom={5}>
      <SiteLayers sites={sites} onSelect={() => {}} />
    </Map>,
  );
}

const layer = (id: string) => {
  const found = layers.find((l) => l.id === id);
  if (!found) throw new Error(`no layer ${id}`);
  return found;
};

function evaluate(value: unknown, zoom: number, properties: Props): unknown {
  const parsed = createExpression(value, "paint");
  if (parsed.result !== "success") throw new Error(JSON.stringify(parsed.value));
  return parsed.value.evaluate({ zoom }, { type: 1, properties } as never);
}

function shows(id: string, properties: Props): boolean {
  const { filter } = featureFilter(layer(id).filter as never, "filter");
  return filter({ zoom: 5 }, { type: 1, properties, geometry: [] } as never);
}

function sitePoint(id: string): Props {
  const points = sources.find((s) => s.id === "points")?.data as FeatureCollection;
  const feature = points.features.find((f) => f.properties?.id === id);
  if (!feature?.properties) throw new Error(`no point ${id}`);
  return feature.properties;
}

beforeEach(() => {
  layers.length = 0;
  sources.length = 0;
});

describe("<Map> sites", () => {
  it("builds layers the style spec accepts", () => {
    renderMap();
    const style = {
      version: 8,
      glyphs: "https://example.org/{fontstack}/{range}.pbf",
      sources: { s: { type: "geojson", data: { type: "FeatureCollection", features: [] } } },
      layers: layers.map((l) => ({ ...l, source: "s" })),
    };
    expect(validateStyleMin(style as never).map((e) => e.message)).toEqual([]);
  });

  it("stacks every site layer under the event pins", () => {
    renderMap();
    const order = layers.map((l) => l.id);
    const lowestPin = Math.min(...[CLUSTER_LAYER, STACK_LAYER, ...POINT_LAYERS].map((id) => order.indexOf(id)));
    const siteLayers = ["sites-zone-fill", "sites-zone-line", SITE_POINT_LAYER, SITE_RING_LAYER];
    for (const id of siteLayers) expect(order.indexOf(id)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...siteLayers.map((id) => order.indexOf(id)))).toBeLessThan(lowestPin);
  });

  it("counts events and sites in one cluster number", () => {
    renderMap();
    const cluster = { cluster: true, point_count: 7, sites: 2 };
    expect(shows(CLUSTER_LAYER, cluster)).toBe(true);
    expect(evaluate((layer("cluster-count").layout as Props)["text-field"], 5, cluster)).toBe("7");
  });

  it("rings a cluster that holds a site, and no other", () => {
    renderMap();
    expect(shows(SITE_RING_LAYER, { cluster: true, point_count: 7, sites: 2 })).toBe(true);
    expect(shows(SITE_RING_LAYER, { cluster: true, point_count: 7, sites: 0 })).toBe(false);
    expect(shows(SITE_RING_LAYER, { id: DEPOT.id, kind: "site" })).toBe(false);
  });

  it("draws the cluster ring a gap outside the circle", () => {
    renderMap();
    const cluster = { cluster: true, point_count: 300, sites: 1 };
    const circle = evaluate(clusterRadius(["get", "point_count"]), 5, cluster) as number;
    const radius = (layer(SITE_RING_LAYER).paint as Props)["circle-radius"];
    expect(evaluate(radius, 5, cluster)).toBe(circle + SITE_RING_GAP_PX);
    expect((layer(SITE_RING_LAYER).paint as Props)["circle-opacity"]).toBe(0);
  });

  it("draws a lone site as a ring of one size below zoom 10, whatever its zone's size", () => {
    renderMap();
    const ring = layer(SITE_POINT_LAYER);
    const paint = ring.paint as Props;
    expect(shows(SITE_POINT_LAYER, sitePoint(DEPOT.id))).toBe(true);
    expect(shows(SITE_POINT_LAYER, sitePoint(AIRBASE.id))).toBe(true);
    expect(shows(SITE_POINT_LAYER, { id: EVENT_ID })).toBe(false);
    expect(ring.minzoom).toBeUndefined();
    expect(ring.maxzoom).toBe(SITE_POINT_MAX_ZOOM);

    // The airbase's zone, 0.05 degrees on each side, spans about 30 px at zoom 9: the ring keeps its
    // size and stays opaque.
    for (const id of [DEPOT.id, AIRBASE.id]) {
      for (const zoom of [2, 9]) {
        expect(evaluate(paint["circle-radius"], zoom, sitePoint(id))).toBe(SITE_RING_RADIUS_PX);
      }
    }
    expect(paint["circle-stroke-opacity"]).toBeUndefined();
  });

  it("draws the zones from zoom 10 only", () => {
    renderMap();
    for (const id of ["sites-zone-fill", "sites-zone-line"]) {
      expect(layer(id).minzoom).toBe(SITE_POINT_MAX_ZOOM);
    }
  });

  it("puts no site in the clusters from zoom 10, where the zones stand for them", () => {
    render(
      <Map points={[EVENT]} sites={[DEPOT]} zoom={11}>
        <SiteLayers sites={[DEPOT]} />
      </Map>,
    );
    const points = sources.find((s) => s.id === "points")?.data as FeatureCollection;
    expect(points.features.map((f) => f.properties?.id)).toEqual([EVENT_ID]);
  });
});
