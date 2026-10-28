"use client";

import { useMap, type MapRef } from "react-map-gl/maplibre";
import { LocateFixed } from "lucide-react";

import { GO_TO_ZOOM, type CoordinatePair } from "@/lib/coordinates";

import { GoToCoordinates } from "./GoToCoordinates";
import { MapPopoverControl } from "./MapPopoverControl";

/** Centres `map` on a typed point, keeping a reader's deeper zoom. No `essential` flag, so
 *  reduced motion gets the camera without the flight. */
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
