"use client";

import { useState } from "react";

import { CoordinateActions, CoordinateValue } from "@/components/event/CoordinateActions";
import { eventPanelContent } from "@/components/event/EventDetailBody";
import { CoordinateInputs } from "@/components/geolocations/CoordinateInputs";
import { MapPanelBody } from "@/components/map/MapSidePanel";
import { MOCK_DETAIL, Variant, type PaletteCategory } from "./shared";

const LAT = 48.015883;
const LNG = 37.802411;

function PaletteCoordinateInputs() {
  const [lat, setLat] = useState(String(LAT));
  const [lng, setLng] = useState(String(LNG));
  return (
    <div className="w-full max-w-xs">
      <CoordinateInputs idPrefix="palette_" lat={lat} setLat={setLat} lng={lng} setLng={setLng} />
    </div>
  );
}

export const MAP: PaletteCategory = {
  id: "map",
  title: "Coordinates and map",
  entries: [
    { name: "CoordinateInputs", demo: <PaletteCoordinateInputs /> },
    {
      name: "CoordinateActions / CoordinateValue",
      demo: (
        <>
          <CoordinateActions lat={LAT} lng={LNG} />
          <Variant label="null pair">
            <CoordinateActions lat={null} lng={null} />
          </Variant>
          <Variant label="small">
            <CoordinateActions lat={LAT} lng={LNG} small />
          </Variant>
          <Variant label="CoordinateValue">
            <CoordinateValue lat={LAT} lng={LNG} />
          </Variant>
        </>
      ),
    },
    {
      name: "MapPanelBody / eventPanelContent",
      demo: (
        <div className="w-[380px] max-w-full space-y-4">
          <MapPanelBody
            content={eventPanelContent({
              ...MOCK_DETAIL,
              detected_from_url: "https://x.com/analyst/status/1234567890",
            })}
          />
        </div>
      ),
    },
  ],
};
