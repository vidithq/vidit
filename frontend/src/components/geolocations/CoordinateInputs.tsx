"use client";

import { FORM_LABEL } from "@/components/ui/form-styles";
import { Input } from "@/components/ui/Input";

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
  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-1.5">
        <label htmlFor={latId} className={FORM_LABEL}>
          Latitude
        </label>
        <Input
          id={latId}
          type="text"
          required={required}
          value={lat}
          onChange={(e) => setLat(e.target.value)}
          placeholder="48.015883"
          className="font-mono"
          invalid={invalid}
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor={lngId} className={FORM_LABEL}>
          Longitude
        </label>
        <Input
          id={lngId}
          type="text"
          required={required}
          value={lng}
          onChange={(e) => setLng(e.target.value)}
          placeholder="37.802411"
          className="font-mono"
          invalid={invalid}
        />
      </div>
    </div>
  );
}
