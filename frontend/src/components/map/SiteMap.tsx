"use client";

import { useMemo } from "react";
import { Layer, Source } from "react-map-gl/maplibre";
import type { FeatureCollection } from "geojson";

import type { MapPoint } from "@/types";
import { useTheme } from "@/hooks/useTheme";
import { SITE_MAP_COLORS } from "@/lib/palette";
import { formatDistance, type SiteLinkedEvent, type Zone } from "@/lib/sites";
import { nearestPointOnZone } from "@/lib/siteZone";
import type { MapBounds } from "@/lib/viewport";
import Map from "./Map";
import { useUnderEventPins } from "./SiteLayers";

const ZONE_FILL = "site-zone-fill";
const ZONE_LINE = "site-zone-line";
const PREVIOUS_LINE = "site-previous-line";
const CONNECTOR_LINE = "site-connector-line";
const CONNECTOR_LABEL = "site-connector-label";
const LAYERS = [ZONE_FILL, ZONE_LINE, PREVIOUS_LINE, CONNECTOR_LINE, CONNECTOR_LABEL];

/** A site seen up close fills most of the frame. */
const SITE_FIT_MAX_ZOOM = 15;

function ZoneLayers({
  zone,
  previousZone,
  emphasis,
  outside,
}: {
  zone: Zone;
  previousZone: Zone | null;
  emphasis: "damage" | "destruction" | null;
  outside: SiteLinkedEvent[];
}) {
  const colors = SITE_MAP_COLORS[useTheme()];
  const color = emphasis ? colors[emphasis] : colors.zone;
  useUnderEventPins(LAYERS);

  const connectors = useMemo<FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: outside.map((event) => {
        const from: [number, number] = [event.event_coords.lng, event.event_coords.lat];
        const to = nearestPointOnZone(zone, from);
        return {
          type: "Feature",
          properties: { distance: event.distance_m === null ? "" : formatDistance(event.distance_m) },
          geometry: { type: "LineString", coordinates: [from, to] },
        };
      }),
    }),
    [outside, zone],
  );

  return (
    <>
      <Source id="site-zone" type="geojson" data={{ type: "Feature", properties: {}, geometry: zone }}>
        <Layer id={ZONE_FILL} type="fill" paint={{ "fill-color": color, "fill-opacity": 0.2 }} />
        <Layer id={ZONE_LINE} type="line" paint={{ "line-color": color, "line-width": 2 }} />
      </Source>
      <Source
        id="site-previous"
        type="geojson"
        data={
          previousZone
            ? { type: "Feature", properties: {}, geometry: previousZone }
            : { type: "FeatureCollection", features: [] }
        }
      >
        <Layer
          id={PREVIOUS_LINE}
          type="line"
          paint={{
            "line-color": colors.zone,
            "line-width": 1.5,
            "line-opacity": 0.8,
            "line-dasharray": [3, 2],
          }}
        />
      </Source>
      <Source id="site-connectors" type="geojson" data={connectors}>
        <Layer
          id={CONNECTOR_LINE}
          type="line"
          paint={{ "line-color": colors.zone, "line-width": 1.5, "line-dasharray": [1, 2] }}
        />
        <Layer
          id={CONNECTOR_LABEL}
          type="symbol"
          layout={{
            "symbol-placement": "line-center",
            "text-field": ["get", "distance"],
            "text-font": ["Montserrat Medium", "Noto Sans Regular"],
            "text-size": 11,
            "text-offset": [0, -0.8],
          }}
          paint={{ "text-color": colors.zone, "text-halo-color": colors.halo, "text-halo-width": 1.2 }}
        />
      </Source>
    </>
  );
}

/**
 * A site's own map: the zone shown (coloured only by a damage or destruction link), the zone
 * before it dashed, the linked events as pins, and a dotted line with its distance from each
 * event outside the zone it was measured against. Events measured against another zone are dimmed.
 */
export default function SiteMap({
  zone,
  previousZone,
  observationId,
  emphasis,
  events,
  bounds,
  onEventClick,
}: {
  zone: Zone;
  previousZone: Zone | null;
  /** The observation `zone` comes from: events measured against another one are dimmed. */
  observationId: string;
  emphasis: "damage" | "destruction" | null;
  events: SiteLinkedEvent[];
  bounds: MapBounds;
  onEventClick: (id: string) => void;
}) {
  const points = useMemo<MapPoint[]>(
    () => events.map((e) => [e.id, e.event_coords.lat, e.event_coords.lng, e.event_date, "", 0]),
    [events],
  );
  const dimmed = useMemo(
    () => new Set(events.filter((e) => e.measured_observation_id !== observationId).map((e) => e.id)),
    [events, observationId],
  );
  const outside = useMemo(
    () => events.filter((e) => !e.inside_zone && e.measured_observation_id === observationId),
    [events, observationId],
  );

  return (
    <Map
      points={points}
      onPointClick={onEventClick}
      fitBounds={bounds}
      fitMaxZoom={SITE_FIT_MAX_ZOOM}
      dimmedIds={dimmed}
      embedded
    >
      <ZoneLayers zone={zone} previousZone={previousZone} emphasis={emphasis} outside={outside} />
    </Map>
  );
}
