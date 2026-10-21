"use client";

import { useEffect, useMemo } from "react";
import { Layer, Source, useMap } from "react-map-gl/maplibre";
import type { ExpressionSpecification, MapLayerMouseEvent } from "maplibre-gl";
import type { FeatureCollection } from "geojson";

import { useTheme } from "@/hooks/useTheme";
import { SITE_MAP_COLORS } from "@/lib/palette";
import type { Zone } from "@/lib/sites";
import { CLUSTER_LAYER, TAP_TARGET_LAYERS } from "./layers";

/** From this zoom the map draws zones; below it a corroborated site is one square. */
export const ZONE_MIN_ZOOM = 10;

const FILL = "sites-zone-fill";
const LINE = "sites-zone-line";
const LINE_FADED = "sites-zone-line-faded";
const MARKER = "sites-marker";
const LABEL = "sites-label";
const CLICK_LAYERS = [FILL, MARKER, LABEL];
const ALL_LAYERS = [FILL, LINE, LINE_FADED, MARKER, LABEL];

const ICON_PX = 24;
const ICON_BORDER_PX = 3;
const ICON_PIXEL_RATIO = 2;

export interface MapSite {
  id: string;
  name: string;
  zone: Zone;
  centroid: { lat: number; lng: number };
  corroborated: boolean;
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

/**
 * The sites layer of a map, mounted as `<Map>` children: zones from `zoneMinZoom` (faded and dashed
 * for a site nobody but its owner corroborates), one square per corroborated site below it, names
 * beside both. Every layer sits under the event pins.
 */
export function SiteLayers({
  sites,
  selectedId,
  onSelect,
  zoneMinZoom = ZONE_MIN_ZOOM,
}: {
  sites: MapSite[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  zoneMinZoom?: number;
}) {
  const { current: map } = useMap();
  const colors = SITE_MAP_COLORS[useTheme()];
  const icon = iconId(colors.zone);

  useEffect(() => {
    if (!map) return;
    const raw = map.getMap();
    // A style reload drops every image, so the icon is re-added after each one.
    const ensure = () => {
      if (raw.hasImage(icon)) return;
      try {
        raw.addImage(icon, squareIcon(colors.zone), { pixelRatio: ICON_PIXEL_RATIO });
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
  }, [map, icon, colors.zone]);

  useUnderEventPins(ALL_LAYERS);

  useEffect(() => {
    if (!map || !onSelect) return;
    const click = (e: MapLayerMouseEvent) => {
      const pins = TAP_TARGET_LAYERS.filter((id) => map.getLayer(id));
      if (pins.length > 0 && map.queryRenderedFeatures(e.point, { layers: pins }).length > 0) return;
      const id = e.features?.[0]?.properties?.id;
      if (typeof id === "string") onSelect(id);
    };
    const pointerOn = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const pointerOff = () => {
      map.getCanvas().style.cursor = "";
    };
    map.on("click", CLICK_LAYERS, click);
    map.on("mouseenter", CLICK_LAYERS, pointerOn);
    map.on("mouseleave", CLICK_LAYERS, pointerOff);
    return () => {
      map.off("click", CLICK_LAYERS, click);
      map.off("mouseenter", CLICK_LAYERS, pointerOn);
      map.off("mouseleave", CLICK_LAYERS, pointerOff);
    };
  }, [map, onSelect]);

  const zones = useMemo<FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: sites.map((site) => ({
        type: "Feature",
        properties: {
          id: site.id,
          corroborated: site.corroborated ? 1 : 0,
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
          corroborated: site.corroborated ? 1 : 0,
          selected: site.id === selectedId ? 1 : 0,
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
            "fill-opacity": [
              "case",
              ["==", ["get", "corroborated"], 0],
              0.06,
              ["==", ["get", "selected"], 1],
              0.3,
              0.18,
            ],
          }}
        />
        <Layer
          id={LINE}
          type="line"
          minzoom={zoneMinZoom}
          filter={["==", ["get", "corroborated"], 1]}
          paint={{
            "line-color": color,
            "line-width": ["case", ["==", ["get", "selected"], 1], 2.5, 1.5],
          }}
        />
        <Layer
          id={LINE_FADED}
          type="line"
          minzoom={zoneMinZoom}
          filter={["==", ["get", "corroborated"], 0]}
          paint={{
            "line-color": color,
            "line-width": ["case", ["==", ["get", "selected"], 1], 2, 1],
            "line-opacity": 0.6,
            "line-dasharray": [2, 2],
          }}
        />
      </Source>
      <Source id="sites-markers" type="geojson" data={markers}>
        {zoneMinZoom > 0 && (
          <Layer
            id={MARKER}
            type="symbol"
            maxzoom={zoneMinZoom}
            filter={["==", ["get", "corroborated"], 1]}
            layout={{
              "icon-image": icon,
              "icon-allow-overlap": true,
              "icon-size": ["case", ["==", ["get", "selected"], 1], 1.4, 1],
              "text-field": ["get", "name"],
              "text-font": ["Montserrat Medium", "Noto Sans Regular"],
              "text-size": 11,
              "text-anchor": "left",
              "text-offset": [1, 0],
              "text-optional": true,
            }}
            paint={{
              "text-color": colors.zone,
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
            "text-font": ["Montserrat Medium", "Noto Sans Regular"],
            "text-size": 11,
          }}
          paint={{
            "text-color": colors.zone,
            "text-halo-color": colors.halo,
            "text-halo-width": 1.2,
            "text-opacity": ["case", ["==", ["get", "corroborated"], 1], 1, 0.6],
          }}
        />
      </Source>
    </>
  );
}
