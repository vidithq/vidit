"use client";

import { useEffect, useMemo, useState } from "react";
import { Layer, Source, useMap } from "react-map-gl/maplibre";

import { MAP_LAYER_COLORS } from "@/lib/palette";

import { aboveBasemap, isOverlaySource, type Brightness } from "./basemap";
import {
  DAILY_IMAGERY_SOURCE,
  GIBS_ATTRIBUTION,
  dailyImagerySource,
  gibsDate,
  loadFireDetections,
  type FireDetections,
} from "./gibs";

const IMAGERY = "daily-imagery";
const FIRES = "fire-detections";
/** Bottom to top, these draw directly above the basemap and under every other overlay. */
const SATELLITE_LAYERS = [IMAGERY, FIRES];

const EMPTY: FireDetections = { type: "FeatureCollection", features: [] };

/** Keeps the satellite layers, in their order, right above the basemap: under the coordinate grid,
 *  the sites and the event pins, whichever mounted first. */
function useAboveBasemap() {
  const { current: map } = useMap();
  useEffect(() => {
    if (!map) return;
    const raw = map.getMap();
    const isOverlayLayer = (id: string) => {
      const source = raw.getLayer(id)?.source;
      return source !== undefined && isOverlaySource(source, raw.getSource(source)?.type ?? "");
    };
    const order = () => {
      const move = aboveBasemap(raw.getLayersOrder(), SATELLITE_LAYERS, isOverlayLayer);
      if (move) for (const id of move.layers) raw.moveLayer(id, move.before);
    };
    order();
    raw.on("styledata", order);
    return () => {
      raw.off("styledata", order);
    };
  }, [map]);
}

/** NASA GIBS overlays of the day before, in UTC: the VIIRS true-colour imagery and the VIIRS fire
 *  detections. Both are overlays, so a basemap swap keeps them (`carryOverlays`). */
export function SatelliteOverlays({
  imagery,
  fires,
  brightness,
}: {
  imagery: boolean;
  fires: boolean;
  brightness: Brightness;
}) {
  const date = useMemo(() => gibsDate(new Date()), []);
  const [detections, setDetections] = useState<FireDetections>(EMPTY);
  useAboveBasemap();

  useEffect(() => {
    if (!fires) return;
    let live = true;
    loadFireDetections(date).then(
      (loaded) => {
        if (live) setDetections(loaded);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [fires, date]);

  return (
    <>
      {imagery && (
        <Source id={DAILY_IMAGERY_SOURCE} {...dailyImagerySource(date)}>
          <Layer id={IMAGERY} type="raster" paint={{ "raster-opacity": 0.55 }} />
        </Source>
      )}
      {fires && (
        <Source id={FIRES} type="geojson" data={detections} attribution={GIBS_ATTRIBUTION}>
          <Layer
            id={FIRES}
            type="circle"
            paint={{
              "circle-color": MAP_LAYER_COLORS[brightness].fire,
              "circle-opacity": 0.9,
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 1.5, 8, 3, 14, 6],
            }}
          />
        </Source>
      )}
    </>
  );
}
