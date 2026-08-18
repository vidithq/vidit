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
  /** Flag the coordinate inputs as a missing required field (red outline). */
  invalid?: boolean;
  /** The optional camera position (where the footage was shot from), distinct
   *  from the subject coordinates above. Both halves or neither. */
  captureLat: string;
  setCaptureLat: (v: string) => void;
  captureLng: string;
  setCaptureLng: (v: string) => void;
}

/** The "Location" section: the subject coordinates (where the footage was
 *  filmed) and the optional camera position (where it was shot from). Source
 *  media is its own block (`SourceMediaField`). Shared by the submit + edit
 *  forms. */
export function LocationPicker({
  lat,
  setLat,
  lng,
  setLng,
  invalid = false,
  captureLat,
  setCaptureLat,
  captureLng,
  setCaptureLng,
}: LocationPickerProps) {
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
        <CoordinateInputs
          lat={lat}
          setLat={setLat}
          lng={lng}
          setLng={setLng}
          invalid={invalid}
        />
      </div>

      {/* The camera position (where the footage was shot from) kept apart
          from the subject point above. Optional and always independent of the
          lifecycle. */}
      <div className="space-y-1.5">
        <span className={`${LABEL_TEXT} inline-flex items-center gap-1`}>
          Camera position <FieldHelp concept="capture_source_coords" />
        </span>
        <CoordinateInputs
          idPrefix="capture_"
          required={false}
          lat={captureLat}
          setLat={setCaptureLat}
          lng={captureLng}
          setLng={setCaptureLng}
        />
      </div>
    </Card>
  );
}
