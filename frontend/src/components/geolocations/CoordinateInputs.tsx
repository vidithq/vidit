"use client";

import { useId, type ClipboardEvent } from "react";

import { CoordinateActions } from "@/components/event/CoordinateActions";
import { FieldError } from "@/components/ui/ErrorNotice";
import { Input } from "@/components/ui/Input";
import { coordinatePair, pairProblem, parsePastedCoordinates } from "@/lib/coordinates";

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
  const errorId = useId();

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
  const problem = pair ? null : pairProblem(lat, lng);
  // A typed value that is wrong shows at once. A blank half waits for the write's floor on a
  // required pair; an optional pair is not saved while it holds one half.
  const shown = problem && (!problem.missing || (!required && problem.half !== null)) ? problem : null;
  const describedBy = (half: "lat" | "lng") => (shown?.half === half ? errorId : undefined);

  return (
    <div className="space-y-1.5">
      {/* One line at every width, the narrowest source editor at 320px included: two shrinking
          columns, then the actions, which take only their own width. No visible labels: the
          `aria-label`s name the fields. */}
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-1.5">
        <div>
          <Input
            id={latId}
            type="text"
            required={required}
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            onPaste={onPastePair}
            aria-label="Latitude"
            placeholder="48.015883"
            className={FIELD_PADDING}
            invalid={invalid || shown?.half === "lat"}
            aria-describedby={describedBy("lat")}
          />
        </div>
        <div>
          <Input
            id={lngId}
            type="text"
            required={required}
            value={lng}
            onChange={(e) => setLng(e.target.value)}
            onPaste={onPastePair}
            aria-label="Longitude"
            placeholder="37.802411"
            className={FIELD_PADDING}
            invalid={invalid || shown?.half === "lng"}
            aria-describedby={describedBy("lng")}
          />
        </div>
        {/* Always mounted so nothing shifts when the pair becomes valid. */}
        <div>
          <CoordinateActions
            lat={pair?.lat ?? null}
            lng={pair?.lng ?? null}
            problem={problem?.message}
          />
        </div>
      </div>
      <FieldError id={errorId}>
        {shown &&
          (required
            ? shown.message
            : `${shown.message} Until the pair is complete or both fields are empty, the position is not saved.`)}
      </FieldError>
    </div>
  );
}
