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
  /** Flag both inputs as a missing/invalid required field (red outline). */
  invalid?: boolean;
  /** Distinct field ids so a second pair (the camera position) doesn't collide
   *  with the subject's `lat` / `lng`. Defaults to the subject pair. */
  idPrefix?: string;
  /** The subject pair is required; the optional camera pair passes `false`. */
  required?: boolean;
}

/** The latitude / longitude input pair. Shared by the submit form's
 *  `LocationPicker` (the subject and the optional camera position) and the
 *  detection edit form, so the coordinate field can't drift between them. */
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

  // A coordinate is almost always copied as a pair (from a maps URL, a tweet,
  // a spreadsheet), so a paste that reads as one fills both halves whichever
  // field received it. Anything else pastes as ordinary text.
  const onPastePair = (e: ClipboardEvent<HTMLInputElement>) => {
    const pair = parsePastedCoordinates(e.clipboardData.getData("text"));
    if (pair === null) return;
    e.preventDefault();
    setLat(String(pair.lat));
    setLng(String(pair.lng));
  };

  // The verification affordances only act on a real point, so they grey out
  // while the pair is half-typed or out of bounds.
  const pair = coordinatePair(lat, lng);

  return (
    // Three columns from `sm` up: the two fields, then the actions on the same
    // row, so checking a coordinate against imagery is a move to the right
    // rather than a jump to a line of its own. Below `sm` the third cell spans
    // the pair and wraps under it, where a third column would squeeze the
    // fields down to a few characters.
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-[1fr_1fr_auto]">
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
        />
      </div>

      <div className="col-span-2 flex flex-col sm:col-span-1">
        {/* An empty label line, so the actions land level with the inputs
            rather than with the words above them. Only from `sm` up: below it
            the cell sits under the pair, with no label row to clear. */}
        <span aria-hidden className={`hidden sm:block ${FORM_LABEL}`}>
          &nbsp;
        </span>
        {/* `flex-1` + `items-center` against a cell the grid stretches to the
            field's height, which is what centres the buttons on the inputs
            without either side naming a pixel height. */}
        <div className="flex flex-1 items-center justify-end">
          {/* Always mounted, greyed until the pair parses: the cell holds one
              width, so the row does not jump the moment the second half of a
              coordinate is typed. */}
          <CoordinateActions lat={pair?.lat ?? null} lng={pair?.lng ?? null} />
        </div>
      </div>
    </div>
  );
}
