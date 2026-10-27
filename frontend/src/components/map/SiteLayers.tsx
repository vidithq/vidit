"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Layer, Source, useMap } from "react-map-gl/maplibre";
import type { ExpressionSpecification, MapLayerMouseEvent } from "maplibre-gl";
import type { FeatureCollection } from "geojson";

import { SITE_MAP_COLORS } from "@/lib/palette";
import { isCoarsePointer } from "@/lib/pointer";
import type { Zone } from "@/lib/sites";
import { useBasemapBrightness } from "./basemapSettings";
import { CLUSTER_LAYER, TAP_TARGET_LAYERS } from "./layers";
import { MapPreviewCard, PREVIEW_INTENT_MS } from "./MapPreviewCard";

/** From this zoom the map draws zones; below it each site is one square. */
export const ZONE_MIN_ZOOM = 10;

const FILL = "sites-zone-fill";
const LINE = "sites-zone-line";
const MARKER = "sites-marker";
const LABEL = "sites-label";
const CLICK_LAYERS = [FILL, MARKER, LABEL];
const ALL_LAYERS = [FILL, LINE, MARKER, LABEL];

const ICON_PX = 24;
const ICON_BORDER_PX = 3;
const ICON_PIXEL_RATIO = 2;

export interface MapSite {
  id: string;
  name: string;
  zone: Zone;
  centroid: { lat: number; lng: number };
  emphasis?: "damage" | "destruction" | null;
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

function iconId(color: string): string {
  return `site-square-${color.replace("#", "")}`;
}

// A filled square with a solid border, built by hand: `addImage` takes raw RGBA, and a symbol icon
// is the only way to keep a site square under the round event pins in the same paint stack.
function squareIcon(color: string) {
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  const data = new Uint8Array(ICON_PX * ICON_PX * 4);
  for (let y = 0; y < ICON_PX; y++) {
    for (let x = 0; x < ICON_PX; x++) {
      const edge =
        x < ICON_BORDER_PX || y < ICON_BORDER_PX || x >= ICON_PX - ICON_BORDER_PX || y >= ICON_PX - ICON_BORDER_PX;
      const i = (y * ICON_PX + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = edge ? 255 : 110;
    }
  }
  return { width: ICON_PX, height: ICON_PX, data };
}

/** A hovered site: its id and the pointer in map-container px. */
interface HoverTarget {
  id: string;
  x: number;
  y: number;
}

/**
 * The sites layer of a map, mounted as `<Map>` children: zones from `zoneMinZoom`, one square per
 * site below it, names beside both. Every layer sits under the event pins.
 *
 * With `onSelect`, a site takes the pointer like an event pin: the hand cursor, a click selects it,
 * and with `renderPreview` a mouse resting on it shows that content in the map's preview card after
 * the same hover intent. A pin over the site takes the click and the hover instead.
 */
export function SiteLayers({
  sites,
  selectedId,
  onSelect,
  renderPreview,
  zoneMinZoom = ZONE_MIN_ZOOM,
}: {
  sites: MapSite[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** The preview of a hovered site, or null for none. */
  renderPreview?: (id: string) => ReactNode;
  zoneMinZoom?: number;
}) {
  const { current: map } = useMap();
  const colors = SITE_MAP_COLORS[useBasemapBrightness()];
  const [hover, setHover] = useState<HoverTarget | null>(null);
  // The hover whose intent delay ran out; a new hover object restarts the delay.
  const [shownHover, setShownHover] = useState<HoverTarget | null>(null);
  const hoveredIdRef = useRef<string | null>(null);
  // One square per paint a zone can take, so a marker wears its zone's emphasis.
  const icons = useMemo(
    () => ({ zone: colors.zone, damage: colors.damage, destruction: colors.destruction }),
    [colors.zone, colors.damage, colors.destruction],
  );

  useEffect(() => {
    if (!map) return;
    const raw = map.getMap();
    // A style reload drops every image, so the icons are re-added after each one.
    const ensure = () => {
      for (const color of Object.values(icons)) {
        const id = iconId(color);
        if (raw.hasImage(id)) continue;
        try {
          raw.addImage(id, squareIcon(color), { pixelRatio: ICON_PIXEL_RATIO });
        } catch {
          // The style is not ready yet; its `styledata` event retries.
        }
      }
    };
    ensure();
    raw.on("styledata", ensure);
    raw.on("styleimagemissing", ensure);
    return () => {
      raw.off("styledata", ensure);
      raw.off("styleimagemissing", ensure);
    };
  }, [map, icons]);

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
    map.on("click", CLICK_LAYERS, click);
    map.on("mousemove", CLICK_LAYERS, move);
    map.on("mouseleave", CLICK_LAYERS, leave);
    map.on("movestart", clearHover);
    return () => {
      map.off("click", CLICK_LAYERS, click);
      map.off("mousemove", CLICK_LAYERS, move);
      map.off("mouseleave", CLICK_LAYERS, leave);
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
        properties: {
          id: site.id,
          selected: site.id === selectedId ? 1 : 0,
          emphasis: site.emphasis ?? "none",
        },
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
        properties: {
          id: site.id,
          name: site.name,
          selected: site.id === selectedId ? 1 : 0,
          emphasis: site.emphasis ?? "none",
        },
        geometry: { type: "Point", coordinates: [site.centroid.lng, site.centroid.lat] },
      })),
    }),
    [sites, selectedId],
  );

  const color: ExpressionSpecification = [
    "match",
    ["get", "emphasis"],
    "damage",
    colors.damage,
    "destruction",
    colors.destruction,
    colors.zone,
  ];

  return (
    <>
      <Source id="sites-zones" type="geojson" data={zones}>
        <Layer
          id={FILL}
          type="fill"
          minzoom={zoneMinZoom}
          paint={{
            "fill-color": color,
            "fill-opacity": ["case", ["==", ["get", "selected"], 1], 0.22, 0.12],
          }}
        />
        <Layer
          id={LINE}
          type="line"
          minzoom={zoneMinZoom}
          paint={{
            "line-color": color,
            "line-width": ["case", ["==", ["get", "selected"], 1], 3, 2],
          }}
        />
      </Source>
      <Source id="sites-markers" type="geojson" data={markers}>
        {zoneMinZoom > 0 && (
          <Layer
            id={MARKER}
            type="symbol"
            maxzoom={zoneMinZoom}
            layout={{
              "icon-image": [
                "match",
                ["get", "emphasis"],
                "damage",
                iconId(icons.damage),
                "destruction",
                iconId(icons.destruction),
                iconId(icons.zone),
              ],
              "icon-allow-overlap": true,
              "icon-size": ["case", ["==", ["get", "selected"], 1], 1.4, 1],
              "text-field": ["get", "name"],
              "text-font": ["Montserrat Medium"],
              "text-size": 11,
              "text-anchor": "left",
              "text-offset": [1, 0],
              "text-optional": true,
            }}
            paint={{
              "text-color": color,
              "text-halo-color": colors.halo,
              "text-halo-width": 1.2,
            }}
          />
        )}
        <Layer
          id={LABEL}
          type="symbol"
          minzoom={zoneMinZoom}
          layout={{
            "text-field": ["get", "name"],
            "text-font": ["Montserrat Medium"],
            "text-size": 11,
          }}
          paint={{
            "text-color": color,
            "text-halo-color": colors.halo,
            "text-halo-width": 1.2,
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
