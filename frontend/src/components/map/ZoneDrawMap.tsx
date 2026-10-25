"use client";

import { useEffect, useMemo, useRef } from "react";
import { Layer, Source, useMap } from "react-map-gl/maplibre";
import type { MapLayerMouseEvent, MapLayerTouchEvent, MapMouseEvent, MapTouchEvent } from "maplibre-gl";
import type { Feature, FeatureCollection } from "geojson";

import { usePalette } from "@/hooks/usePalette";
import { useTheme } from "@/hooks/useTheme";
import { SITE_MAP_COLORS, paletteMapColors } from "@/lib/palette";
import {
  MIN_ZONE_VERTICES,
  edgeMidpoints,
  insertVertex,
  moveVertex,
  type DrawState,
} from "@/lib/siteZone";
import type { Zone } from "@/lib/sites";
import type { MapBounds } from "@/lib/viewport";
import Map from "./Map";
import { SiteLayers, type MapSite } from "./SiteLayers";

const SHAPE_FILL = "draw-fill";
const SHAPE_LINE = "draw-line";
const REFERENCE_LINE = "draw-reference-line";
const MIDPOINTS = "draw-midpoints";
const VERTICES = "draw-vertices";
const CLOSER = "draw-closer";

/** A click this close to the first corner closes the ring. */
const CLOSE_SNAP_PX = 12;
const DRAW_FIT_MAX_ZOOM = 15;

/** `transient` marks a drag step, which the editor's undo folds into the step that started it. */
export type DrawChange = (next: DrawState, transient?: boolean) => void;

function DrawInteractions({ state, onChange }: { state: DrawState; onChange: DrawChange }) {
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
      const current = stateRef.current;
      const { vertices, closed } = current;
      if (closed) {
        const hit = map.queryRenderedFeatures(e.point, { layers: [VERTICES, MIDPOINTS] });
        if (hit.length === 0 && current.selected !== null) onChange({ ...current, selected: null });
        return;
      }
      if (vertices.length >= MIN_ZONE_VERTICES) {
        const first = map.project(vertices[0]);
        if (Math.hypot(first.x - e.point.x, first.y - e.point.y) <= CLOSE_SNAP_PX) {
          onChange({ ...current, closed: true, selected: null });
          return;
        }
      }
      onChange({ ...current, vertices: [...vertices, [e.lngLat.lng, e.lngLat.lat]] });
    };

    const startDrag = (index: number) => {
      dragRef.current = index;
      canvas.style.cursor = "grabbing";
    };
    // Only a closed ring's corners drag: an open ring's first corner closes it on click.
    const grabVertex = (e: MapLayerMouseEvent | MapLayerTouchEvent) => {
      const index = e.features?.[0]?.properties?.index;
      const current = stateRef.current;
      if (typeof index !== "number" || !current.closed) return;
      e.preventDefault();
      onChange({ ...current, selected: index });
      startDrag(index);
    };
    const grabMidpoint = (e: MapLayerMouseEvent | MapLayerTouchEvent) => {
      const edge = e.features?.[0]?.properties?.edge;
      const current = stateRef.current;
      if (typeof edge !== "number" || !current.closed) return;
      e.preventDefault();
      const next = insertVertex(current, edge, [e.lngLat.lng, e.lngLat.lat]);
      onChange(next);
      startDrag(edge + 1);
    };
    const move = (e: MapMouseEvent | MapTouchEvent) => {
      const index = dragRef.current;
      if (index === null) return;
      onChange(moveVertex(stateRef.current, index, [e.lngLat.lng, e.lngLat.lat]), true);
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
    map.on("mousedown", VERTICES, grabVertex);
    map.on("touchstart", VERTICES, grabVertex);
    map.on("mousedown", MIDPOINTS, grabMidpoint);
    map.on("touchstart", MIDPOINTS, grabMidpoint);
    map.on("mousemove", move);
    map.on("touchmove", move);
    map.on("mouseup", release);
    map.on("touchend", release);
    for (const layer of [VERTICES, MIDPOINTS]) {
      map.on("mouseenter", layer, hoverOn);
      map.on("mouseleave", layer, hoverOff);
    }
    return () => {
      map.off("click", click);
      map.off("mousedown", VERTICES, grabVertex);
      map.off("touchstart", VERTICES, grabVertex);
      map.off("mousedown", MIDPOINTS, grabMidpoint);
      map.off("touchstart", MIDPOINTS, grabMidpoint);
      map.off("mousemove", move);
      map.off("touchmove", move);
      map.off("mouseup", release);
      map.off("touchend", release);
      for (const layer of [VERTICES, MIDPOINTS]) {
        map.off("mouseenter", layer, hoverOn);
        map.off("mouseleave", layer, hoverOff);
      }
    };
  }, [map, onChange]);

  return null;
}

function DrawLayers({ state, reference }: { state: DrawState; reference: Zone | null }) {
  const accent = paletteMapColors(usePalette()).base;
  const colors = SITE_MAP_COLORS[useTheme()];
  const { vertices, closed, selected } = state;

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
          selected: index === selected ? 1 : 0,
          closer: !closed && index === 0 && vertices.length >= MIN_ZONE_VERTICES ? 1 : 0,
        },
        geometry: { type: "Point", coordinates: v },
      })),
    }),
    [vertices, closed, selected],
  );

  const midpoints = useMemo<FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: closed
        ? edgeMidpoints(vertices).map((v, edge) => ({
            type: "Feature",
            properties: { edge },
            geometry: { type: "Point", coordinates: v },
          }))
        : [],
    }),
    [vertices, closed],
  );

  return (
    <>
      <Source
        id="draw-reference"
        type="geojson"
        data={
          reference
            ? { type: "Feature", properties: {}, geometry: reference }
            : { type: "FeatureCollection", features: [] }
        }
      >
        <Layer
          id={REFERENCE_LINE}
          type="line"
          paint={{ "line-color": colors.zone, "line-width": 1.5, "line-dasharray": [3, 2] }}
        />
      </Source>
      <Source id="draw-shape" type="geojson" data={shape}>
        <Layer
          id={SHAPE_FILL}
          type="fill"
          filter={["==", ["geometry-type"], "Polygon"]}
          paint={{ "fill-color": accent, "fill-opacity": 0.2 }}
        />
        <Layer id={SHAPE_LINE} type="line" paint={{ "line-color": accent, "line-width": 2 }} />
      </Source>
      <Source id="draw-midpoints" type="geojson" data={midpoints}>
        <Layer
          id={MIDPOINTS}
          type="circle"
          paint={{
            "circle-radius": 4,
            "circle-color": accent,
            "circle-opacity": 0.55,
            "circle-stroke-color": colors.halo,
            "circle-stroke-width": 1,
          }}
        />
      </Source>
      <Source id="draw-corners" type="geojson" data={corners}>
        <Layer
          id={CLOSER}
          type="circle"
          filter={["==", ["get", "closer"], 1]}
          paint={{ "circle-radius": 11, "circle-color": accent, "circle-opacity": 0.25 }}
        />
        <Layer
          id={VERTICES}
          type="circle"
          paint={{
            "circle-radius": ["case", ["==", ["get", "selected"], 1], 7, 5.5],
            "circle-color": ["case", ["==", ["get", "selected"], 1], accent, colors.halo],
            "circle-stroke-color": ["case", ["==", ["get", "selected"], 1], "#ffffff", accent],
            "circle-stroke-width": 2,
          }}
        />
      </Source>
    </>
  );
}

/**
 * The contour editor's canvas. An open ring takes a corner per click and closes on a click on
 * its first corner. A closed ring edits in place: a corner drags, a click picks it, and the
 * small dot in the middle of each edge drags out a new corner. `reference` draws a zone dashed
 * under the drawing (the contour being redrawn), and `sites` the neighbours a new site may
 * overlap. The toolbar is the caller's.
 */
export default function ZoneDrawMap({
  state,
  onChange,
  sites,
  reference = null,
  bounds,
  center,
  onBoundsChange,
}: {
  state: DrawState;
  onChange: DrawChange;
  sites: MapSite[];
  reference?: Zone | null;
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
      <DrawLayers state={state} reference={reference} />
      <DrawInteractions state={state} onChange={onChange} />
    </Map>
  );
}
