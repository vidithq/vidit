"use client";

import { useEffect, useMemo, useRef } from "react";
import { useMap } from "react-map-gl/maplibre";
import type { MapMouseEvent, MapTouchEvent } from "maplibre-gl";

import type { CoordinatePair } from "@/lib/coordinates";
import type { MapPoint } from "@/types";
import { POINT_LAYERS } from "./layers";
import Map from "./Map";
import { useLayerDrag } from "./useLayerDrag";

/** The camera a point opens at: a town and its roads. */
const POINT_ZOOM = 12;

function pairOf(e: MapMouseEvent | MapTouchEvent): CoordinatePair {
  const { lat, lng } = e.lngLat.wrap();
  return { lat, lng };
}

/** A click on the map moves the pin there, and the pin drags. Each step hands the point, its
 *  longitude wrapped into -180 to 180, to `onPick`. */
function PickInteractions({ onPick }: { onPick: (pair: CoordinatePair) => void }) {
  const { current: map } = useMap();
  useLayerDrag(POINT_LAYERS, { grab: () => true, drag: (e) => onPick(pairOf(e)) });

  // Read through a ref: every step re-renders the caller with a new `onPick`.
  const pickRef = useRef(onPick);
  useEffect(() => {
    pickRef.current = onPick;
  }, [onPick]);
  useEffect(() => {
    if (!map) return;
    // A click on the pin is no move. Filtered because `queryRenderedFeatures` throws on a layer
    // the style does not hold yet.
    const click = (e: MapMouseEvent) => {
      const layers = POINT_LAYERS.filter((layer) => map.getLayer(layer));
      if (layers.length > 0 && map.queryRenderedFeatures(e.point, { layers }).length > 0) return;
      pickRef.current(pairOf(e));
    };
    map.on("click", click);
    return () => {
      map.off("click", click);
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
