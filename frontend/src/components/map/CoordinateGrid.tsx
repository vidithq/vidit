"use client";

import { useEffect, useState } from "react";
import { Layer, Source, useMap } from "react-map-gl/maplibre";
import type { FeatureCollection } from "geojson";

import { MAP_LAYER_COLORS } from "@/lib/palette";

import type { Brightness } from "./basemap";
import { graticule } from "./graticule";
import { useUnderEventPins } from "./SiteLayers";

const LINE = "coordinate-grid-line";
const LABEL = "coordinate-grid-label";
const LAYERS = [LINE, LABEL];

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

/** The coordinate grid overlay: a graticule of the view, rebuilt when the map comes to rest. It is
 *  a GeoJSON source, so a basemap swap keeps it (`carryOverlays`), and it draws under the event
 *  pins on every preset. */
export function CoordinateGrid({ brightness }: { brightness: Brightness }) {
  const { current: map } = useMap();
  const [data, setData] = useState<FeatureCollection>(EMPTY);
  useUnderEventPins(LAYERS);

  useEffect(() => {
    if (!map) return;
    const update = () => {
      const b = map.getBounds();
      setData(
        graticule(
          { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() },
          map.getZoom(),
        ),
      );
    };
    update();
    map.on("moveend", update);
    return () => {
      map.off("moveend", update);
    };
  }, [map]);

  const colors = MAP_LAYER_COLORS[brightness];
  return (
    <Source id="coordinate-grid" type="geojson" data={data}>
      <Layer id={LINE} type="line" paint={{ "line-color": colors.grid, "line-width": 0.75 }} />
      <Layer
        id={LABEL}
        type="symbol"
        layout={{
          "symbol-placement": "line",
          "symbol-spacing": 400,
          "text-field": ["get", "label"],
          "text-font": ["Montserrat Regular"],
          "text-size": 10,
        }}
        paint={{
          "text-color": colors.gridLabel,
          "text-halo-color": colors.gridHalo,
          "text-halo-width": 1.5,
        }}
      />
    </Source>
  );
}
