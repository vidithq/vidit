"use client";

import type { ClipboardEvent } from "react";

import { CoordinateActions } from "@/components/event/CoordinateActions";
import { FORM_INVALID_LABEL, FORM_LABEL } from "@/components/ui/form-styles";
import { Input } from "@/components/ui/Input";
import { coordinatePair, parsePastedCoordinates } from "@/lib/coordinates";

// Half the field's side padding and tight tracking, so a 6-decimal value shows
// whole beside the actions in the forms' side column and on a 375px phone.
const FIELD_PADDING = "font-mono tracking-tight px-1.5";

interface CoordinateInputsProps {
  lat: string;
  setLat: (v: string) => void;
  lng: string;
  setLng: (v: string) => void;
  invalid?: boolean;
  /** Distinct ids so a capture pair doesn't collide with `lat` / `lng`. */
  idPrefix?: string;
  /** The optional capture pair passes `false`. */
  required?: boolean;
}

/** The latitude / longitude input pair, shared by `LocationPicker` (the subject) and each
 *  `SourceEditor` (its capture position). */
export function CoordinateInputs({
  lat,
  setLat,
  lng,
  setLng,
  invalid = false,
  idPrefix = "",
  required = true,
}: CoordinateInputsProps) {
  const latId = `${idPrefix}lat`;
  const lngId = `${idPrefix}lng`;

  // A paste that reads as a coordinate pair fills both halves; anything else
  // pastes as text.
  const onPastePair = (e: ClipboardEvent<HTMLInputElement>) => {
    const pair = parsePastedCoordinates(e.clipboardData.getData("text"));
    if (pair === null) return;
    e.preventDefault();
    setLat(String(pair.lat));
    setLng(String(pair.lng));
  };

  // The actions grey out while the pair is half-typed or out of bounds.
  const pair = coordinatePair(lat, lng);

  const label = `${FORM_LABEL}${invalid ? ` ${FORM_INVALID_LABEL}` : ""}`;

  return (
    // One line at every width, the narrowest source editor at 320px included:
    // two shrinking columns, then the actions, which take only their own width.
    // The fields sit on the second grid row so the actions centre on them, not on
    // the labels.
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-1.5">
      <label htmlFor={latId} className={label}>
        Latitude
      </label>
      <label htmlFor={lngId} className={label}>
        Longitude
      </label>
      <div className="row-start-2">
        <Input
          id={latId}
          type="text"
          required={required}
          value={lat}
          onChange={(e) => setLat(e.target.value)}
          onPaste={onPastePair}
          placeholder="48.015883"
          className={FIELD_PADDING}
          invalid={invalid}
        />
      </div>
      <div className="row-start-2">
        <Input
          id={lngId}
          type="text"
          required={required}
          value={lng}
          onChange={(e) => setLng(e.target.value)}
          onPaste={onPastePair}
          placeholder="37.802411"
          className={FIELD_PADDING}
          invalid={invalid}
        />
      </div>
      {/* Always mounted so nothing shifts when the pair becomes valid. */}
      <div className="row-start-2 self-center">
        <CoordinateActions lat={pair?.lat ?? null} lng={pair?.lng ?? null} />
      </div>
    </div>
  );
}
