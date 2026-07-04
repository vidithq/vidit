"use client";

import type { TweetImportCoord } from "@/types";
import { CoordinateInputs } from "@/components/geolocations/CoordinateInputs";
import { Card } from "@/components/ui/Card";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { FieldHelp } from "@/components/ui/FieldHelp";
import { OptionalHint } from "@/components/ui/OptionalHint";
import { LABEL_TEXT } from "@/components/ui/form-styles";

interface LocationPickerProps {
  lat: string;
  setLat: (v: string) => void;
  lng: string;
  setLng: (v: string) => void;
  /** Leftover coordinates from a tweet import, offered as swap chips. Empty in
   *  the edit form (no import there), so no chips render. */
  extraCoordCandidates: TweetImportCoord[];
  onSwapCandidate: (candidate: TweetImportCoord) => void;
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
 *  filmed), the optional camera position (where it was shot from), plus any
 *  tweet-import swap chips. Source media is its own block now
 *  (`SourceMediaField`). Shared by the submit + edit forms. */
export function LocationPicker({
  lat,
  setLat,
  lng,
  setLng,
  extraCoordCandidates,
  onSwapCandidate,
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
        <span className={`${LABEL_TEXT} inline-flex items-center gap-1`}>
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
          Camera position <FieldHelp concept="capture_source_coords" />{" "}
          <OptionalHint />
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

      {extraCoordCandidates.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-neutral-500">Also detected:</span>
          {extraCoordCandidates.map((c, i) => (
            <button
              key={`${c.lat}-${c.lng}-${i}`}
              type="button"
              onClick={() => onSwapCandidate(c)}
              className="font-mono px-2 py-0.5 rounded-md bg-neutral-800 text-orange-400 hover:bg-neutral-700 transition-colors"
            >
              {c.lat.toFixed(5)}, {c.lng.toFixed(5)} ↺
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}
