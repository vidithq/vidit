"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import MapGL, {
  Source,
  Layer,
  NavigationControl,
  AttributionControl,
  useMap,
} from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import type { MapPoint } from "@/types";
import type { GeoJSONSource, MapLayerMouseEvent } from "maplibre-gl";
import type { FeatureCollection } from "geojson";

interface MapProps {
  points: MapPoint[];
  selectedId?: string | null;
  onPointClick?: (id: string) => void;
  className?: string;
  center?: { lat: number; lng: number };
  zoom?: number;
  // Reports pan/zoom on every move-end so the parent can persist it across
  // navigation. State preservation only — the map stays uncontrolled internally.
  onViewChange?: (view: { latitude: number; longitude: number; zoom: number }) => void;
}

function ClickHandler({
  onPointClick,
}: {
  onPointClick?: (id: string) => void;
}) {
  const { current: map } = useMap();

  useEffect(() => {
    if (!map) return;

    const handleClusterClick = async (e: MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature || feature.geometry.type !== "Point") return;

      const source = map.getSource("points") as GeoJSONSource | undefined;
      if (!source) return;

      const coordinates = feature.geometry.coordinates as [number, number];
      const clusterId = feature.properties?.cluster_id as number | undefined;
      if (clusterId === undefined) return;

      try {
        const zoom = await source.getClusterExpansionZoom(clusterId);
        map.easeTo({ center: coordinates, zoom });
      } catch {
        map.easeTo({ center: coordinates, zoom: (map.getZoom() || 5) + 2 });
      }
    };

    const handlePointClick = (e: MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.id;
      if (typeof id === "string") onPointClick?.(id);
    };

    map.on("click", "clusters", handleClusterClick);
    map.on("click", "points-circle", handlePointClick);
    map.on("click", "points-selected", handlePointClick);

    map.on("mouseenter", "clusters", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "clusters", () => {
      map.getCanvas().style.cursor = "";
    });
    map.on("mouseenter", "points-circle", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "points-circle", () => {
      map.getCanvas().style.cursor = "";
    });

    return () => {
      map.off("click", "clusters", handleClusterClick);
      map.off("click", "points-circle", handlePointClick);
      map.off("click", "points-selected", handlePointClick);
    };
  }, [map, onPointClick]);

  return null;
}

export default function Map({
  points,
  selectedId,
  onPointClick,
  className,
  center,
  zoom,
  onViewChange,
}: MapProps) {
  const [mounted, setMounted] = useState(false);
  // MapLibre needs WebGL, which Tor Browser disables or gates; without
  // this the user gets a black canvas. Detect on mount to swap a message in.
  const [webglMissing, setWebglMissing] = useState(false);
  // Skip the first onMoveEnd MapLibre fires during initial layout: it
  // carries the values we just seeded, so reporting it back is no-op noise.
  const firstMoveEndRef = useRef(true);

  useEffect(() => {
    let ok = false;
    try {
      const canvas = document.createElement("canvas");
      ok = !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
    } catch {
      ok = false;
    }
    setWebglMissing(!ok);
    setMounted(true);
  }, []);

  const geojson = useMemo<FeatureCollection>(() => ({
    type: "FeatureCollection",
    features: points.map(([id, lat, lng]) => ({
      type: "Feature",
      properties: {
        id,
        selected: id === selectedId ? 1 : 0,
      },
      geometry: {
        type: "Point",
        coordinates: [lng, lat],
      },
    })),
  }), [points, selectedId]);

  if (!mounted) {
    return (
      <div className={`w-full h-full bg-[#0a0a0a] flex items-center justify-center ${className || ""}`}>
        <span className="text-neutral-500 text-sm">Loading map...</span>
      </div>
    );
  }

  if (webglMissing) {
    return (
      <div className={`w-full h-full bg-[#0a0a0a] flex items-center justify-center px-6 ${className || ""}`}>
        <p className="max-w-md text-center text-neutral-400 text-sm">
          The map needs WebGL, which is disabled in your browser. If you&apos;re on Tor Browser, switch the security level to Standard.
        </p>
      </div>
    );
  }

  return (
    <div className={className || ""} style={{ width: "100%", height: "100%" }}>
    <MapGL
      initialViewState={{
        latitude: center?.lat ?? 48.5,
        longitude: center?.lng ?? 35.0,
        zoom: zoom ?? 5,
      }}
      onMoveEnd={(evt) => {
        if (firstMoveEndRef.current) {
          firstMoveEndRef.current = false;
          return;
        }
        if (!onViewChange) return;
        const { latitude, longitude, zoom: z } = evt.viewState;
        onViewChange({ latitude, longitude, zoom: z });
      }}
      style={{ width: "100%", height: "100%" }}
      mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
      projection="globe"
      attributionControl={false}
    >
      <ClickHandler onPointClick={onPointClick} />
      <NavigationControl position="bottom-left" showCompass={false} />
      <AttributionControl position="bottom-left" compact={false} />

      <Source
        id="points"
        type="geojson"
        data={geojson}
        cluster={true}
        clusterMaxZoom={14}
        clusterRadius={50}
      >
        {/* Radius scales with point count */}
        <Layer
          id="clusters"
          type="circle"
          filter={["has", "point_count"]}
          paint={{
            "circle-color": [
              "step",
              ["get", "point_count"],
              "#f97316",
              1000, "#ea580c",
              10000, "#c2410c",
            ],
            "circle-opacity": 0.85,
            "circle-radius": [
              "step",
              ["get", "point_count"],
              12,       // < 50
              50, 16,   // 50-199
              200, 20,  // 200-999
              1000, 26, // 1k-4999
              5000, 34, // 5k-9999
              10000, 42, // 10k+
            ],
          }}
        />

        <Layer
          id="cluster-count"
          type="symbol"
          filter={["has", "point_count"]}
          layout={{
            "text-field": "{point_count_abbreviated}",
            "text-font": ["Montserrat Medium", "Noto Sans Regular"],
            "text-size": [
              "step",
              ["get", "point_count"],
              11,
              1000, 13,
              10000, 15,
            ],
          }}
          paint={{
            "text-color": "#ffffff",
          }}
        />

        <Layer
          id="points-selected"
          type="circle"
          filter={[
            "all",
            ["!", ["has", "point_count"]],
            ["==", ["get", "selected"], 1],
          ]}
          paint={{
            "circle-radius": 7,
            "circle-color": "#f97316",
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2,
            "circle-opacity": 1,
          }}
        />

        <Layer
          id="points-circle"
          type="circle"
          filter={[
            "all",
            ["!", ["has", "point_count"]],
            ["==", ["get", "selected"], 0],
          ]}
          paint={{
            "circle-radius": 6,
            "circle-color": "#f97316",
            "circle-stroke-color": "#f97316",
            "circle-stroke-width": 1,
            "circle-opacity": 1,
          }}
        />
      </Source>
    </MapGL>
    </div>
  );
}
