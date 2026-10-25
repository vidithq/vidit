"use client";

import { CoordinateInputs } from "@/components/geolocations/CoordinateInputs";
import { Card } from "@/components/ui/Card";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";

interface LocationPickerProps {
  lat: string;
  setLat: (v: string) => void;
  lng: string;
  setLng: (v: string) => void;
  invalid?: boolean;
}

/** The "Location" section: the subject coordinates, shared by every event form, under the event
 *  page's eyebrow. Each source carries its own capture position. The eyebrow heads the side column
 *  beside the Sources scroller, whose header always holds Add a source, so the two columns' first
 *  blocks start level. */
export function LocationPicker({ lat, setLat, lng, setLng, invalid = false }: LocationPickerProps) {
  return (
    <section>
      <SectionEyebrow title="Location" concept="section_location" besideScroller />
      <Card>
        <CoordinateInputs lat={lat} setLat={setLat} lng={lng} setLng={setLng} invalid={invalid} />
      </Card>
    </section>
  );
}
