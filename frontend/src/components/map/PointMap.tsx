"use client";

import { useEffect, useMemo, useRef } from "react";
import { useMap } from "react-map-gl/maplibre";
import type {
  MapLayerMouseEvent,
  MapLayerTouchEvent,
  MapMouseEvent,
  MapTouchEvent,
} from "maplibre-gl";

import type { CoordinatePair } from "@/lib/coordinates";
import type { MapPoint } from "@/types";
import { POINT_LAYERS } from "./layers";
import Map from "./Map";

/** The camera a point opens at: a town and its roads. */
const POINT_ZOOM = 12;

/** A click on the map moves the pin there, and the pin drags. Each step hands the point, its
 *  longitude wrapped into -180 to 180, to `onPick`. */
function PickInteractions({ onPick }: { onPick: (pair: CoordinatePair) => void }) {
  const { current: map } = useMap();
  // Read through a ref: every step re-renders the caller with a new `onPick`, and new listeners
  // would drop the drag under way.
  const pickRef = useRef(onPick);
  useEffect(() => {
    pickRef.current = onPick;
  }, [onPick]);

  useEffect(() => {
    if (!map) return;
    const canvas = map.getCanvas();
    let dragging = false;

    const pick = (e: MapMouseEvent | MapTouchEvent) => {
      const { lat, lng } = e.lngLat.wrap();
      pickRef.current({ lat, lng });
    };
    // A click on the pin is no move. Filtered because `queryRenderedFeatures` throws on a layer
    // the style does not hold yet.
    const click = (e: MapMouseEvent) => {
      const layers = POINT_LAYERS.filter((layer) => map.getLayer(layer));
      if (layers.length > 0 && map.queryRenderedFeatures(e.point, { layers }).length > 0) return;
      pick(e);
    };
    const grab = (e: MapLayerMouseEvent | MapLayerTouchEvent) => {
      if ("points" in e && e.points.length > 1) return;
      // Holds the map's own pan for this gesture.
      e.preventDefault();
      dragging = true;
      canvas.style.cursor = "grabbing";
    };
    const move = (e: MapMouseEvent | MapTouchEvent) => {
      if (!dragging) return;
      // A finger dragging the pin must not scroll the page under it.
      if (e.type === "touchmove") e.originalEvent.preventDefault();
      pick(e);
    };
    const release = () => {
      if (!dragging) return;
      dragging = false;
      canvas.style.cursor = "";
    };
    const hoverOn = () => {
      if (!dragging) canvas.style.cursor = "grab";
    };
    const hoverOff = () => {
      if (!dragging) canvas.style.cursor = "";
    };

    map.on("click", click);
    map.on("mousedown", POINT_LAYERS, grab);
    map.on("touchstart", POINT_LAYERS, grab);
    map.on("mousemove", move);
    map.on("touchmove", move);
    map.on("mouseup", release);
    map.on("touchend", release);
    map.on("mouseenter", POINT_LAYERS, hoverOn);
    map.on("mouseleave", POINT_LAYERS, hoverOff);
    return () => {
      map.off("click", click);
      map.off("mousedown", POINT_LAYERS, grab);
      map.off("touchstart", POINT_LAYERS, grab);
      map.off("mousemove", move);
      map.off("touchmove", move);
      map.off("mouseup", release);
      map.off("touchend", release);
      map.off("mouseenter", POINT_LAYERS, hoverOn);
      map.off("mouseleave", POINT_LAYERS, hoverOff);
    };
  }, [map]);

  return null;
}

/**
 * The small map of one point, with its pin: the event page's Location block, and the event
 * forms' under the coordinates. With `onPick`, a click on the map moves the pin there and the pin
 * drags; the pin is then no stored event, so a hover opens no card. No `point` shows the map
 * without a pin. The camera opens on the point and follows `goTo`.
 */
export default function PointMap({
  point,
  id = "point",
  detected = false,
  onPick,
  goTo = null,
}: {
  point: CoordinatePair | null;
  /** The pin's id: the event's on its page, so a hover opens its card. */
  id?: string;
  /** Paints the pin as a machine detection. */
  detected?: boolean;
  onPick?: (pair: CoordinatePair) => void;
  goTo?: CoordinatePair | null;
}) {
  const lat = point?.lat ?? null;
  const lng = point?.lng ?? null;
  // [id, lat, lng] and the detected flag; the two date slots are inert.
  const points = useMemo<MapPoint[]>(
    () => (lat === null || lng === null ? [] : [[id, lat, lng, "", "", detected ? 1 : 0]]),
    [id, lat, lng, detected],
  );
  return (
    <Map
      points={points}
      center={point ?? undefined}
      zoom={point ? POINT_ZOOM : undefined}
      goTo={goTo}
      pinPreview={!onPick}
      embedded
    >
      {onPick && <PickInteractions onPick={onPick} />}
    </Map>
  );
}
