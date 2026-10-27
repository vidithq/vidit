"use client";

import { useMap, type MapRef } from "react-map-gl/maplibre";
import { LocateFixed } from "lucide-react";

import type { CoordinatePair } from "@/lib/coordinates";

import { GoToCoordinates } from "./GoToCoordinates";
import { MapPopoverControl } from "./MapPopoverControl";

// The least zoom a typed coordinate lands at, where roads and buildings read. A reader zoomed in
// further keeps their zoom.
const GO_TO_ZOOM = 14;

/** Centres `map` on a typed point. No `essential` flag, so reduced motion gets the camera
 *  without the flight. */
export function goToPoint(map: MapRef, { lat, lng }: CoordinatePair) {
  map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), GO_TO_ZOOM) });
}

/** The go-to-coordinates field as a map control beside the zoom buttons, in a panel above it.
 *  A pair that reads closes the panel and centres the map. */
export function GoToCoordinatesControl() {
  const { current: map } = useMap();
  return (
    <MapPopoverControl label="Go to coordinates" icon={<LocateFixed size={15} />}>
      {(close) => (
        <GoToCoordinates
          autoFocus
          onGo={(pair) => {
            if (map) goToPoint(map, pair);
            close(true);
          }}
        />
      )}
    </MapPopoverControl>
  );
}
