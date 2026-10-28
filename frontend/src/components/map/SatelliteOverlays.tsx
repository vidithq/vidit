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

// The events that start or end a tile or data load; `idle` ends every load, a failed one included.
const LOAD_EVENTS = ["dataloading", "data", "moveend", "idle"] as const;

/** Whether the map is still loading `id` while `on`: the tiles in view of a raster source, or a
 *  GeoJSON source's data. A tile that fails to load counts as done. */
function useSourceLoading(id: string, on: boolean): boolean {
  const { current: map } = useMap();
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!map || !on) return;
    const raw = map.getMap();
    const check = () => setLoading(raw.getSource(id) !== undefined && !raw.isSourceLoaded(id));
    for (const event of LOAD_EVENTS) raw.on(event, check);
    return () => {
      for (const event of LOAD_EVENTS) raw.off(event, check);
    };
  }, [map, id, on]);
  return on && loading;
}

/** NASA GIBS overlays of the day before, in UTC: the VIIRS true-colour imagery and the VIIRS fire
 *  detections. Both are overlays, so a basemap swap keeps them (`carryOverlays`). */
export function SatelliteOverlays({
  imagery,
  fires,
  brightness,
  onLoadingChange,
}: {
  imagery: boolean;
  fires: boolean;
  brightness: Brightness;
  /** Called with true while a shown overlay is still loading, and with false once both have
   *  loaded or failed, or when the overlays unmount. */
  onLoadingChange: (loading: boolean) => void;
}) {
  const date = useMemo(() => gibsDate(new Date()), []);
  const [detections, setDetections] = useState<FireDetections>(EMPTY);
  // Whether the day's detections have arrived or failed: a failure stops the loading state too.
  const [settled, setSettled] = useState(false);
  useAboveBasemap();

  useEffect(() => {
    if (!fires) return;
    let live = true;
    loadFireDetections(date)
      .then(
        (loaded) => {
          if (live) setDetections(loaded);
        },
        () => {},
      )
      .finally(() => {
        if (live) setSettled(true);
      });
    return () => {
      live = false;
    };
  }, [fires, date]);

  const imageryLoading = useSourceLoading(DAILY_IMAGERY_SOURCE, imagery);
  const firesSourceLoading = useSourceLoading(FIRES, fires);
  const loading = imageryLoading || (fires && (!settled || firesSourceLoading));
  useEffect(() => {
    onLoadingChange(loading);
    return () => onLoadingChange(false);
  }, [loading, onLoadingChange]);

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
