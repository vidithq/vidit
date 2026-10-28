"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Layer, Source, useMap } from "react-map-gl/maplibre";
import type { ExpressionSpecification, MapLayerMouseEvent } from "maplibre-gl";
import type { FeatureCollection } from "geojson";

import { usePalette } from "@/hooks/usePalette";
import { paletteMapColors } from "@/lib/palette";
import { isCoarsePointer } from "@/lib/pointer";
import type { Zone } from "@/lib/sites";
import {
  CLUSTER_LAYER,
  SITE_POINT_LAYER,
  SITE_RING_WIDTH_PX,
  SITE_ZONE_FILL_OPACITY,
  TAP_TARGET_LAYERS,
} from "./layers";
import { MapPreviewCard, PREVIEW_INTENT_MS } from "./MapPreviewCard";

const FILL = "sites-zone-fill";
const LINE = "sites-zone-line";
const SITE_LAYERS = [FILL, SITE_POINT_LAYER];
const ZONE_LAYERS = [FILL, LINE];

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
 * The sites layer of a map, mounted as `<Map>` children: the zones at every zoom, under the event
 * pins, in the event pin colour. Below `SITE_POINT_MAX_ZOOM` the sites also join `<Map>`'s
 * clusters (its `sites`), where a lone site is a ring. The map prints no site name: the preview
 * and the side panel carry it.
 *
 * With `onSelect`, a zone or a lone site's ring takes the pointer like an event pin: the hand cursor, a
 * click selects it, and with `renderPreview` a mouse resting on it shows that content in the
 * map's preview card after the same hover intent. A pin over the site takes the click and the
 * hover instead.
 */
export function SiteLayers({
  sites,
  selectedId,
  onSelect,
  renderPreview,
}: {
  sites: MapSite[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** The preview of a hovered site, or null for none. */
  renderPreview?: (id: string) => ReactNode;
}) {
  const { current: map } = useMap();
  const accent = paletteMapColors(usePalette()).base;
  const [hover, setHover] = useState<HoverTarget | null>(null);
  // The hover whose intent delay ran out; a new hover object restarts the delay.
  const [shownHover, setShownHover] = useState<HoverTarget | null>(null);
  const hoveredIdRef = useRef<string | null>(null);

  useUnderEventPins(ZONE_LAYERS);

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
    // `mousemove`, not `mouseenter` alone: leaving a pin inside a zone resets the cursor while the
    // zone, never left, fires no new enter.
    const move = (e: MapLayerMouseEvent) => {
      map.getCanvas().style.cursor = "pointer";
      // A tap's compatibility `mousemove` would open the card over the panel the tap opens.
      if (isCoarsePointer() || map.isMoving() || overPin(e.point)) {
        clearHover();
        return;
      }
      const id = e.features?.[0]?.properties?.id;
      if (typeof id !== "string" || id === hoveredIdRef.current) return;
      hoveredIdRef.current = id;
      setHover({ id, x: e.point.x, y: e.point.y });
    };
    const leave = () => {
      map.getCanvas().style.cursor = "";
      clearHover();
    };
    map.on("click", SITE_LAYERS, click);
    map.on("mousemove", SITE_LAYERS, move);
    map.on("mouseleave", SITE_LAYERS, leave);
    map.on("movestart", clearHover);
    return () => {
      map.off("click", SITE_LAYERS, click);
      map.off("mousemove", SITE_LAYERS, move);
      map.off("mouseleave", SITE_LAYERS, leave);
      map.off("movestart", clearHover);
    };
  }, [map, onSelect]);

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

  return (
    <>
      <Source id="sites-zones" type="geojson" data={zones}>
        <Layer
          id={FILL}
          type="fill"
          paint={{
            "fill-color": accent,
            "fill-opacity": ["case", SELECTED, 0.22, SITE_ZONE_FILL_OPACITY],
          }}
        />
        <Layer
          id={LINE}
          type="line"
          paint={{
            "line-color": accent,
            "line-width": ["case", SELECTED, 3, SITE_RING_WIDTH_PX],
          }}
        />
      </Source>
      {hover && preview && (
        <MapPreviewCard x={hover.x} y={hover.y}>
          {preview}
        </MapPreviewCard>
      )}
    </>
  );
}
