"use client";

import { useEffect, useRef } from "react";
import { useMap } from "react-map-gl/maplibre";
import type {
  MapLayerMouseEvent,
  MapLayerTouchEvent,
  MapMouseEvent,
  MapTouchEvent,
} from "maplibre-gl";

export interface LayerDrag {
  /** A press on a feature of `layers`. True starts the drag; false leaves the press to the map. */
  grab: (e: MapLayerMouseEvent | MapLayerTouchEvent) => boolean;
  /** Each pointer move while the drag lasts. */
  drag: (e: MapMouseEvent | MapTouchEvent) => void;
  /** Whether a hover on `layers` shows the grab cursor. */
  canGrab?: () => boolean;
}

/**
 * Drags a feature of `layers` with the mouse or one finger, inside a `<Map>`. A grab holds the
 * map's own pan for the gesture, and a finger dragging does not scroll the page under it. A
 * second finger leaves the gesture to the map, so a pinch still zooms. `layers` must keep its
 * identity across renders; the handlers may change on every render.
 */
export function useLayerDrag(layers: string[], handlers: LayerDrag): void {
  const { current: map } = useMap();
  // Read through a ref: new listeners on every render would drop the drag under way.
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    if (!map) return;
    const canvas = map.getCanvas();
    let dragging = false;

    const grab = (e: MapLayerMouseEvent | MapLayerTouchEvent) => {
      if ("points" in e && e.points.length > 1) return;
      if (!handlersRef.current.grab(e)) return;
      e.preventDefault();
      dragging = true;
      canvas.style.cursor = "grabbing";
    };
    const move = (e: MapMouseEvent | MapTouchEvent) => {
      if (!dragging) return;
      if (e.type === "touchmove") e.originalEvent.preventDefault();
      handlersRef.current.drag(e);
    };
    const release = () => {
      if (!dragging) return;
      dragging = false;
      canvas.style.cursor = "";
    };
    const hoverOn = () => {
      if (!dragging && (handlersRef.current.canGrab?.() ?? true)) canvas.style.cursor = "grab";
    };
    const hoverOff = () => {
      if (!dragging) canvas.style.cursor = "";
    };

    map.on("mousedown", layers, grab);
    map.on("touchstart", layers, grab);
    map.on("mousemove", move);
    map.on("touchmove", move);
    map.on("mouseup", release);
    map.on("touchend", release);
    map.on("mouseenter", layers, hoverOn);
    map.on("mouseleave", layers, hoverOff);
    return () => {
      map.off("mousedown", layers, grab);
      map.off("touchstart", layers, grab);
      map.off("mousemove", move);
      map.off("touchmove", move);
      map.off("mouseup", release);
      map.off("touchend", release);
      map.off("mouseenter", layers, hoverOn);
      map.off("mouseleave", layers, hoverOff);
    };
  }, [map, layers]);
}
