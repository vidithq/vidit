"use client";

import type { ClipboardEvent } from "react";

import { CoordinateActions } from "@/components/event/CoordinateActions";
import { FORM_INVALID_LABEL, FORM_LABEL } from "@/components/ui/form-styles";
import { Input } from "@/components/ui/Input";
import { coordinatePair, parsePastedCoordinates } from "@/lib/coordinates";

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

  return (
    // The pair's actions ride in the longitude field's trailing adornment, 80px
    // on a phone and 72px from `sm` up, so two columns would leave a 9-character
    // value no room in a narrow box (a phone, the forms' side column): one
    // column until the box is 28rem wide.
    <div className="@container">
      <div className="grid grid-cols-1 @md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label
            htmlFor={latId}
            className={`${FORM_LABEL}${invalid ? ` ${FORM_INVALID_LABEL}` : ""}`}
          >
            Latitude
          </label>
          <Input
            id={latId}
            type="text"
            required={required}
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            onPaste={onPastePair}
            placeholder="48.015883"
            className="font-mono"
            invalid={invalid}
          />
        </div>
        <div className="space-y-1.5">
          <label
            htmlFor={lngId}
            className={`${FORM_LABEL}${invalid ? ` ${FORM_INVALID_LABEL}` : ""}`}
          >
            Longitude
          </label>
          <Input
            id={lngId}
            type="text"
            required={required}
            value={lng}
            onChange={(e) => setLng(e.target.value)}
            onPaste={onPastePair}
            placeholder="37.802411"
            className="font-mono"
            invalid={invalid}
            // Always mounted so nothing shifts when the pair becomes valid.
            trailing={
              <CoordinateActions lat={pair?.lat ?? null} lng={pair?.lng ?? null} />
            }
          />
        </div>
      </div>
    </div>
  );
}
