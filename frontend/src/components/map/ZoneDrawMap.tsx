"use client";

import { useEffect, useMemo, useRef } from "react";
import { Layer, Source, useMap } from "react-map-gl/maplibre";
import type { MapLayerMouseEvent, MapLayerTouchEvent, MapMouseEvent, MapTouchEvent } from "maplibre-gl";
import type { Feature, FeatureCollection } from "geojson";

import { usePalette } from "@/hooks/usePalette";
import { useTheme } from "@/hooks/useTheme";
import { SITE_MAP_COLORS, paletteMapColors } from "@/lib/palette";
import { MIN_ZONE_VERTICES, type Position } from "@/lib/siteZone";
import type { MapBounds } from "@/lib/viewport";
import Map from "./Map";
import { SiteLayers, type MapSite } from "./SiteLayers";

const SHAPE_FILL = "draw-fill";
const SHAPE_LINE = "draw-line";
const VERTICES = "draw-vertices";
const START_LINE = "draw-start-line";

/** A click this close to the first corner closes the ring. */
const CLOSE_SNAP_PX = 12;
const DRAW_FIT_MAX_ZOOM = 15;

export interface DrawState {
  vertices: Position[];
  closed: boolean;
}

function DrawInteractions({
  state,
  onChange,
}: {
  state: DrawState;
  onChange: (next: DrawState) => void;
}) {
  const { current: map } = useMap();
  // The handlers read the latest state through a ref, so a drag keeps one set of listeners.
  const stateRef = useRef(state);
  const dragRef = useRef<number | null>(null);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (!map) return;
    const canvas = map.getCanvas();

    const click = (e: MapMouseEvent) => {
      const { vertices, closed } = stateRef.current;
      if (closed) return;
      if (vertices.length >= MIN_ZONE_VERTICES) {
        const first = map.project(vertices[0]);
        if (Math.hypot(first.x - e.point.x, first.y - e.point.y) <= CLOSE_SNAP_PX) {
          onChange({ vertices, closed: true });
          return;
        }
      }
      onChange({ vertices: [...vertices, [e.lngLat.lng, e.lngLat.lat]], closed: false });
    };

    const grab = (e: MapLayerMouseEvent | MapLayerTouchEvent) => {
      const index = e.features?.[0]?.properties?.index;
      if (typeof index !== "number") return;
      // An open ring's first corner closes it on click; only a closed ring's corners drag.
      if (!stateRef.current.closed) return;
      e.preventDefault();
      dragRef.current = index;
      canvas.style.cursor = "grabbing";
    };
    const move = (e: MapMouseEvent | MapTouchEvent) => {
      const index = dragRef.current;
      if (index === null) return;
      const { vertices, closed } = stateRef.current;
      const next = vertices.slice();
      next[index] = [e.lngLat.lng, e.lngLat.lat];
      onChange({ vertices: next, closed });
    };
    const release = () => {
      if (dragRef.current === null) return;
      dragRef.current = null;
      canvas.style.cursor = "";
    };
    const hoverOn = () => {
      if (stateRef.current.closed) canvas.style.cursor = "grab";
    };
    const hoverOff = () => {
      if (dragRef.current === null) canvas.style.cursor = "";
    };

    map.on("click", click);
    map.on("mousedown", VERTICES, grab);
    map.on("touchstart", VERTICES, grab);
    map.on("mousemove", move);
    map.on("touchmove", move);
    map.on("mouseup", release);
    map.on("touchend", release);
    map.on("mouseenter", VERTICES, hoverOn);
    map.on("mouseleave", VERTICES, hoverOff);
    return () => {
      map.off("click", click);
      map.off("mousedown", VERTICES, grab);
      map.off("touchstart", VERTICES, grab);
      map.off("mousemove", move);
      map.off("touchmove", move);
      map.off("mouseup", release);
      map.off("touchend", release);
      map.off("mouseenter", VERTICES, hoverOn);
      map.off("mouseleave", VERTICES, hoverOff);
    };
  }, [map, onChange]);

  return null;
}

function DrawLayers({ state }: { state: DrawState }) {
  const accent = paletteMapColors(usePalette()).base;
  const colors = SITE_MAP_COLORS[useTheme()];
  const { vertices, closed } = state;

  const shape = useMemo<FeatureCollection>(() => {
    const features: Feature[] = [];
    if (closed && vertices.length >= MIN_ZONE_VERTICES) {
      features.push({
        type: "Feature",
        properties: {},
        geometry: { type: "Polygon", coordinates: [[...vertices, vertices[0]]] },
      });
    } else if (vertices.length >= 2) {
      features.push({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: vertices },
      });
    }
    return { type: "FeatureCollection", features };
  }, [vertices, closed]);

  const corners = useMemo<FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: vertices.map((v, index) => ({
        type: "Feature",
        properties: {
          index,
          closer: !closed && index === 0 && vertices.length >= MIN_ZONE_VERTICES ? 1 : 0,
        },
        geometry: { type: "Point", coordinates: v },
      })),
    }),
    [vertices, closed],
  );

  return (
    <>
      <Source id="draw-shape" type="geojson" data={shape}>
        <Layer
          id={SHAPE_FILL}
          type="fill"
          filter={["==", ["geometry-type"], "Polygon"]}
          paint={{ "fill-color": accent, "fill-opacity": 0.2 }}
        />
        <Layer id={SHAPE_LINE} type="line" paint={{ "line-color": accent, "line-width": 2 }} />
      </Source>
      <Source id="draw-corners" type="geojson" data={corners}>
        <Layer
          id={START_LINE}
          type="circle"
          filter={["==", ["get", "closer"], 1]}
          paint={{
            "circle-radius": 10,
            "circle-color": accent,
            "circle-opacity": 0.25,
          }}
        />
        <Layer
          id={VERTICES}
          type="circle"
          paint={{
            "circle-radius": 5,
            "circle-color": colors.halo,
            "circle-stroke-color": accent,
            "circle-stroke-width": 2,
          }}
        />
      </Source>
    </>
  );
}

/**
 * The zone editor's canvas: a click adds a corner, a click on the first corner closes the ring,
 * and a closed ring's corners drag. `sites` show under the drawing for context: the neighbours a
 * new site may overlap, or the site whose new observation starts from its current zone. The
 * toolbar is the caller's.
 */
export default function ZoneDrawMap({
  state,
  onChange,
  sites,
  bounds,
  center,
  onBoundsChange,
}: {
  state: DrawState;
  onChange: (next: DrawState) => void;
  sites: MapSite[];
  onBoundsChange?: (bounds: MapBounds) => void;
  /** Frames the map on a zone being edited; `center` is used otherwise. */
  bounds?: MapBounds;
  center?: { lat: number; lng: number; zoom: number };
}) {
  return (
    <Map
      points={[]}
      fitBounds={bounds}
      fitMaxZoom={DRAW_FIT_MAX_ZOOM}
      center={center ? { lat: center.lat, lng: center.lng } : undefined}
      zoom={center?.zoom}
      onBoundsChange={onBoundsChange}
      embedded
    >
      <SiteLayers sites={sites} zoneMinZoom={0} />
      <DrawLayers state={state} />
      <DrawInteractions state={state} onChange={onChange} />
    </Map>
  );
}

