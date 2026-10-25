"use client";

import { CoordinateInputs } from "@/components/geolocations/CoordinateInputs";
import { Card } from "@/components/ui/Card";
import { FieldLabel } from "@/components/ui/FieldLabel";
import { EVENT_FIELDS } from "@/lib/events";

interface LocationPickerProps {
  lat: string;
  setLat: (v: string) => void;
  lng: string;
  setLng: (v: string) => void;
  invalid?: boolean;
}

/** The Location card of every event form: the subject coordinates, labelled **Coordinates** like
 *  the event page's row. The label turns red with the fields when a publish misses them. Each
 *  source carries its own capture position. */
export function LocationPicker({ lat, setLat, lng, setLng, invalid = false }: LocationPickerProps) {
  return (
    <Card>
      <div className="space-y-1.5">
        <FieldLabel {...EVENT_FIELDS.coordinates} invalid={invalid} />
        <CoordinateInputs lat={lat} setLat={setLat} lng={lng} setLng={setLng} invalid={invalid} />
      </div>
    </Card>
  );
}
