"use client";

import { FORM_INPUT, FORM_INVALID_FIELD, FORM_LABEL } from "@/components/ui/form-styles";

interface CoordinateInputsProps {
  lat: string;
  setLat: (v: string) => void;
  lng: string;
  setLng: (v: string) => void;
  /** Flag both inputs as a missing/invalid required field (red outline). */
  invalid?: boolean;
}

/** The latitude / longitude input pair. Shared by the submit form's
 *  `LocationPicker` and the detection edit form so the coordinate field can't
 *  drift between the two. */
export function CoordinateInputs({
  lat,
  setLat,
  lng,
  setLng,
  invalid = false,
}: CoordinateInputsProps) {
  const inputClass = `${FORM_INPUT} font-mono${invalid ? ` ${FORM_INVALID_FIELD}` : ""}`;
  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-1.5">
        <label htmlFor="lat" className={FORM_LABEL}>
          Latitude
        </label>
        <input
          id="lat"
          type="text"
          required
          value={lat}
          onChange={(e) => setLat(e.target.value)}
          placeholder="48.015883"
          className={inputClass}
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="lng" className={FORM_LABEL}>
          Longitude
        </label>
        <input
          id="lng"
          type="text"
          required
          value={lng}
          onChange={(e) => setLng(e.target.value)}
          placeholder="37.802411"
          className={inputClass}
        />
      </div>
    </div>
  );
}
