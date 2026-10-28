"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Layer, Source, useMap } from "react-map-gl/maplibre";
import type { ExpressionSpecification, GeoJSONSource, MapLayerMouseEvent } from "maplibre-gl";
import type { FeatureCollection } from "geojson";

import { usePalette } from "@/hooks/usePalette";
import { paletteMapColors } from "@/lib/palette";
import { isCoarsePointer } from "@/lib/pointer";
import type { Zone } from "@/lib/sites";
import { useBasemapBrightness } from "./basemapSettings";
import {
  CLUSTER_COUNT_COLOR,
  CLUSTER_COUNT_LAYOUT,
  CLUSTER_LAYER,
  CLUSTER_OPACITY,
  CLUSTER_RADIUS,
  CLUSTER_SOURCE,
  POINT_RADIUS,
  SELECTED_POINT_RADIUS,
  SELECTED_STROKE,
  SELECTED_STROKE_WIDTH,
  TAP_TARGET_LAYERS,
  clusterColor,
} from "./layers";
import { MapPreviewCard, PREVIEW_INTENT_MS } from "./MapPreviewCard";
import { TRIANGLE_RADIUS, triangleSdf } from "./triangle";

/** From this zoom the map draws zones; below it each site is one triangle. */
export const ZONE_MIN_ZOOM = 10;

const MARKER_SOURCE = "sites-markers";
const FILL = "sites-zone-fill";
const LINE = "sites-zone-line";
const MARKER = "sites-marker";
const CLUSTER = "sites-cluster";
const CLICK_LAYERS = [FILL, MARKER];
const POINTER_LAYERS = [FILL, MARKER, CLUSTER];
const ALL_LAYERS = [FILL, LINE, MARKER, CLUSTER];

const TRIANGLE_ICON = "site-triangle";
const SELECTED: ExpressionSpecification = ["==", ["get", "selected"], 1];

export interface MapSite {
  id: string;
  zone: Zone;
  centroid: { lat: number; lng: number };
}

/** Keeps `layerIds` under the event pins: a layer mounted after the pins (a toggled layer) lands on
 * top of the style, so it is moved down on every style change that leaves it above them. */
export function useUnderEventPins(layerIds: readonly string[]) {
  const { current: map } = useMap();
  const key = layerIds.join("|");
  useEffect(() => {
    if (!map) return;
    const raw = map.getMap();
    const ids = key.split("|");
    const order = () => {
      if (!raw.getLayer(CLUSTER_LAYER)) return;
      const stack = raw.getLayersOrder();
      const bottom = stack.indexOf(CLUSTER_LAYER);
      for (const id of ids) {
        if (stack.indexOf(id) > bottom) raw.moveLayer(id, CLUSTER_LAYER);
      }
    };
    order();
    raw.on("styledata", order);
    return () => {
      raw.off("styledata", order);
    };
  }, [map, key]);
}

/** A hovered site: its id and the pointer in map-container px. */
interface HoverTarget {
  id: string;
  x: number;
  y: number;
}

/**
 * The sites layer of a map, mounted as `<Map>` children: zones from `zoneMinZoom`, one triangle per
 * site below it, clustered like the event pins but apart from them, with no name: the preview and
 * the side panel carry it. Every layer sits under the event pins and takes the event pin colour.
 *
 * With `onSelect`, a site takes the pointer like an event pin: the hand cursor, a click selects it,
 * and with `renderPreview` a mouse resting on it shows that content in the map's preview card after
 * the same hover intent. A click on a cluster zooms in. A pin over the site takes the click and the
 * hover instead.
 */
export function SiteLayers({
  sites,
  selectedId,
  onSelect,
  renderPreview,
  zoneMinZoom = ZONE_MIN_ZOOM,
  zoneColor,
}: {
  sites: MapSite[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** The preview of a hovered site, or null for none. */
  renderPreview?: (id: string) => ReactNode;
  zoneMinZoom?: number;
  /** The zones' colour in place of the event pin colour. */
  zoneColor?: string;
}) {
  const { current: map } = useMap();
  const marker = paletteMapColors(usePalette());
  const selectedStroke = SELECTED_STROKE[useBasemapBrightness()];
  const [hover, setHover] = useState<HoverTarget | null>(null);
  // The hover whose intent delay ran out; a new hover object restarts the delay.
  const [shownHover, setShownHover] = useState<HoverTarget | null>(null);
  const hoveredIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!map) return;
    const raw = map.getMap();
    // A style reload drops every image, so the triangle is added again after each one.
    const ensure = () => {
      if (raw.hasImage(TRIANGLE_ICON)) return;
      try {
        raw.addImage(TRIANGLE_ICON, triangleSdf(), { sdf: true });
      } catch {
        // The style is not ready yet; its `styledata` event retries.
      }
    };
    ensure();
    raw.on("styledata", ensure);
    raw.on("styleimagemissing", ensure);
    return () => {
      raw.off("styledata", ensure);
      raw.off("styleimagemissing", ensure);
    };
  }, [map]);

  useUnderEventPins(ALL_LAYERS);

  useEffect(() => {
    if (!map || !onSelect) return;
    const overPin = (point: MapLayerMouseEvent["point"]) => {
      const pins = TAP_TARGET_LAYERS.filter((id) => map.getLayer(id));
      return pins.length > 0 && map.queryRenderedFeatures(point, { layers: pins }).length > 0;
    };
    const clearHover = () => {
      hoveredIdRef.current = null;
      setHover(null);
    };
    const click = (e: MapLayerMouseEvent) => {
      if (overPin(e.point)) return;
      const id = e.features?.[0]?.properties?.id;
      if (typeof id !== "string") return;
      clearHover();
      onSelect(id);
    };
    // Zooms to where the cluster splits, at most to the zones, which tell overlapping sites apart.
    const clickCluster = (e: MapLayerMouseEvent) => {
      if (overPin(e.point)) return;
      const feature = e.features?.[0];
      const clusterId = feature?.properties?.cluster_id;
      if (feature?.geometry.type !== "Point" || typeof clusterId !== "number") return;
      const center = feature.geometry.coordinates as [number, number];
      const source = map.getSource(MARKER_SOURCE) as GeoJSONSource | undefined;
      if (!source) return;
      source
        .getClusterExpansionZoom(clusterId)
        .then((zoom) => map.easeTo({ center, zoom: Math.min(zoom, zoneMinZoom) }))
        .catch(() => map.easeTo({ center, zoom: (map.getZoom() || 5) + 2 }));
    };
    // `mousemove`, not `mouseenter` alone: leaving a pin inside a zone resets the cursor while the
    // zone, never left, fires no new enter.
    const move = (e: MapLayerMouseEvent) => {
      map.getCanvas().style.cursor = "pointer";
      const id = e.features?.[0]?.properties?.id;
      // A tap's compatibility `mousemove` would open the card over the panel the tap opens.
      if (typeof id !== "string" || isCoarsePointer() || map.isMoving() || overPin(e.point)) {
        clearHover();
        return;
      }
      if (id === hoveredIdRef.current) return;
      hoveredIdRef.current = id;
      setHover({ id, x: e.point.x, y: e.point.y });
    };
    const leave = () => {
      map.getCanvas().style.cursor = "";
      clearHover();
    };
    map.on("click", CLICK_LAYERS, click);
    map.on("click", CLUSTER, clickCluster);
    map.on("mousemove", POINTER_LAYERS, move);
    map.on("mouseleave", POINTER_LAYERS, leave);
    map.on("movestart", clearHover);
    return () => {
      map.off("click", CLICK_LAYERS, click);
      map.off("click", CLUSTER, clickCluster);
      map.off("mousemove", POINTER_LAYERS, move);
      map.off("mouseleave", POINTER_LAYERS, leave);
      map.off("movestart", clearHover);
    };
  }, [map, onSelect, zoneMinZoom]);

  // The card waits out the event pins' hover intent, so a sweep across the map flashes nothing.
  useEffect(() => {
    if (!hover) return;
    const timer = setTimeout(() => setShownHover(hover), PREVIEW_INTENT_MS);
    return () => clearTimeout(timer);
  }, [hover]);
  const preview = hover && shownHover === hover && renderPreview ? renderPreview(hover.id) : null;

  const zones = useMemo<FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: sites.map((site) => ({
        type: "Feature",
        properties: { id: site.id, selected: site.id === selectedId ? 1 : 0 },
        geometry: site.zone,
      })),
    }),
    [sites, selectedId],
  );
  const markers = useMemo<FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: sites.map((site) => ({
        type: "Feature",
        properties: { id: site.id, selected: site.id === selectedId ? 1 : 0 },
        geometry: { type: "Point", coordinates: [site.centroid.lng, site.centroid.lat] },
      })),
    }),
    [sites, selectedId],
  );

  return (
    <>
      <Source id="sites-zones" type="geojson" data={zones}>
        <Layer
          id={FILL}
          type="fill"
          minzoom={zoneMinZoom}
          paint={{
            "fill-color": zoneColor ?? marker.base,
            "fill-opacity": ["case", SELECTED, 0.22, 0.12],
          }}
        />
        <Layer
          id={LINE}
          type="line"
          minzoom={zoneMinZoom}
          paint={{
            "line-color": zoneColor ?? marker.base,
            "line-width": ["case", SELECTED, 3, 2],
          }}
        />
      </Source>
      {zoneMinZoom > 0 && (
        <Source id={MARKER_SOURCE} type="geojson" data={markers} {...CLUSTER_SOURCE}>
          <Layer
            id={CLUSTER}
            type="symbol"
            maxzoom={zoneMinZoom}
            filter={["has", "point_count"]}
            layout={{
              ...CLUSTER_COUNT_LAYOUT,
              "icon-image": TRIANGLE_ICON,
              "icon-size": ["/", CLUSTER_RADIUS, TRIANGLE_RADIUS],
              "icon-allow-overlap": true,
              "icon-ignore-placement": true,
            }}
            paint={{
              "icon-color": clusterColor(marker),
              "icon-opacity": CLUSTER_OPACITY,
              "text-color": CLUSTER_COUNT_COLOR,
            }}
          />
          <Layer
            id={MARKER}
            type="symbol"
            maxzoom={zoneMinZoom}
            filter={["!", ["has", "point_count"]]}
            layout={{
              "icon-image": TRIANGLE_ICON,
              "icon-size": [
                "case",
                SELECTED,
                SELECTED_POINT_RADIUS / TRIANGLE_RADIUS,
                POINT_RADIUS / TRIANGLE_RADIUS,
              ],
              "icon-allow-overlap": true,
              "icon-ignore-placement": true,
            }}
            paint={{
              "icon-color": marker.base,
              "icon-halo-color": selectedStroke,
              "icon-halo-width": ["case", SELECTED, SELECTED_STROKE_WIDTH, 0],
            }}
          />
        </Source>
      )}
      {hover && preview && (
        <MapPreviewCard x={hover.x} y={hover.y}>
          {preview}
        </MapPreviewCard>
      )}
    </>
  );
}
