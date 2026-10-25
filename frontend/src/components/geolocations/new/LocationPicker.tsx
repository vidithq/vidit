"use client";

import { CoordinateInputs } from "@/components/geolocations/CoordinateInputs";
import { Card } from "@/components/ui/Card";
import { FieldHelp } from "@/components/ui/FieldHelp";
import { FORM_INVALID_LABEL, LABEL_TEXT } from "@/components/ui/form-styles";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { cn } from "@/lib/cn";

interface LocationPickerProps {
  lat: string;
  setLat: (v: string) => void;
  lng: string;
  setLng: (v: string) => void;
  invalid?: boolean;
}

/** The "Location" section: the subject coordinates, shared by every event form, under the event
 *  page's eyebrow, labelled **Coordinates** like the event page's row. The eyebrow and the label
 *  turn red with the fields when a publish misses them. Each source carries its own capture position. The eyebrow heads the side column
 *  beside the Sources scroller, whose header always holds Add a source, so the two columns' first
 *  blocks start level. */
export function LocationPicker({ lat, setLat, lng, setLng, invalid = false }: LocationPickerProps) {
  return (
    <section>
      <SectionEyebrow title="Location" concept="section_location" besideScroller invalid={invalid} />
      <Card>
        <div className="space-y-1.5">
          <span className={cn("flex items-center gap-1", LABEL_TEXT, invalid && FORM_INVALID_LABEL)}>
            Coordinates <FieldHelp concept="coordinates" />
          </span>
          <CoordinateInputs lat={lat} setLat={setLat} lng={lng} setLng={setLng} invalid={invalid} />
        </div>
      </Card>
    </section>
  );
}
