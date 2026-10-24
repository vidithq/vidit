"use client";

import { CoordinateInputs } from "@/components/geolocations/CoordinateInputs";
import { Card } from "@/components/ui/Card";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { FieldHelp } from "@/components/ui/FieldHelp";
import { FORM_INVALID_LABEL, LABEL_TEXT } from "@/components/ui/form-styles";

interface LocationPickerProps {
  lat: string;
  setLat: (v: string) => void;
  lng: string;
  setLng: (v: string) => void;
  invalid?: boolean;
}

/** The "Location" section: the subject coordinates, shared by every event form. Each source
 *  carries its own capture position. */
export function LocationPicker({ lat, setLat, lng, setLng, invalid = false }: LocationPickerProps) {
  return (
    <Card as="section">
      <SectionHeading title="Location" concept="section_location" />

      <div className="space-y-1.5">
        <span
          className={`${LABEL_TEXT} inline-flex items-center gap-1${
            invalid ? ` ${FORM_INVALID_LABEL}` : ""
          }`}
        >
          Subject <FieldHelp concept="coordinates" />
        </span>
        <CoordinateInputs lat={lat} setLat={setLat} lng={lng} setLng={setLng} invalid={invalid} />
      </div>
    </Card>
  );
}
