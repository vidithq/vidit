"use client";

import { useState } from "react";
import dynamic from "next/dynamic";

import { EventLocation } from "@/components/event/EventLocation";
import { CoordinateInputs } from "@/components/geolocations/CoordinateInputs";
import { FieldLabel } from "@/components/ui/FieldLabel";
import { coordinatePair, pairInputs, type CoordinatePair } from "@/lib/coordinates";
import { EVENT_FIELDS } from "@/lib/events";

const PointMap = dynamic(() => import("@/components/map/PointMap"), { ssr: false });

const pairKey = (pair: CoordinatePair | null) => (pair ? `${pair.lat},${pair.lng}` : null);

interface LocationPickerProps {
  lat: string;
  setLat: (v: string) => void;
  lng: string;
  setLng: (v: string) => void;
  invalid?: boolean;
}

/** The Location block of every event form: the subject coordinates, labelled **Coordinates** like
 *  the event page's row, over the event page's map with the pin. The label turns red with the
 *  fields when a publish misses them. A click on the map or a drag of the pin writes the
 *  coordinates; a pair typed in the fields moves the pin and centres the map on it. Each source
 *  carries its own capture position. */
export function LocationPicker({ lat, setLat, lng, setLng, invalid = false }: LocationPickerProps) {
  const pair = coordinatePair(lat, lng);
  const key = pairKey(pair);
  // The pair the map last saw, and the last one it wrote: only a pair typed in the fields moves
  // the camera, so a click or a drag leaves the map where the reader holds it.
  const [seen, setSeen] = useState(key);
  const [picked, setPicked] = useState<string | null>(null);
  const [goTo, setGoTo] = useState<CoordinatePair | null>(null);
  if (key !== seen) {
    setSeen(key);
    if (pair && key !== picked) setGoTo(pair);
  }

  const pick = (point: CoordinatePair) => {
    const typed = pairInputs(point);
    setPicked(pairKey(coordinatePair(typed.lat, typed.lng)));
    setLat(typed.lat);
    setLng(typed.lng);
  };

  return (
    <EventLocation
      header={
        <>
          <FieldLabel {...EVENT_FIELDS.coordinates} invalid={invalid} />
          <CoordinateInputs lat={lat} setLat={setLat} lng={lng} setLng={setLng} invalid={invalid} />
        </>
      }
      map={<PointMap point={pair} onPick={pick} goTo={goTo} />}
    />
  );
}
