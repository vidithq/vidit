"use client";

import type { BountyDetail, TweetImportCoord } from "@/types";
import { FORM_INPUT, FORM_LABEL } from "@/components/ui/form-styles";
import FieldHelp from "@/components/ui/FieldHelp";
import { EvidenceUploader } from "./EvidenceUploader";

interface LocationPickerProps {
  // Source media (the footage establishing the location) lives in this block.
  lockedMedia: BountyDetail["media"] | null;
  files: File[];
  setFiles: (files: File[]) => void;
  lat: string;
  setLat: (v: string) => void;
  lng: string;
  setLng: (v: string) => void;
  /** Leftover coordinates from a tweet import, offered as swap chips. */
  extraCoordCandidates: TweetImportCoord[];
  onSwapCandidate: (candidate: TweetImportCoord) => void;
  /** Geolocation carries coordinates; a bounty (an unfinished geolocation)
   *  doesn't yet, so its Location block is the source media alone. */
  showCoords?: boolean;
}

/** The "Location" section: the source media plus — for a geolocation — the
 *  coordinates where it was filmed. The footage and the point it pins,
 *  together. A bounty reuses the same block without the coordinates. */
export function LocationPicker({
  lockedMedia,
  files,
  setFiles,
  lat,
  setLat,
  lng,
  setLng,
  extraCoordCandidates,
  onSwapCandidate,
  showCoords = true,
}: LocationPickerProps) {
  return (
    <section className="bg-neutral-900 rounded-lg border border-neutral-700 p-5 space-y-4">
      <header>
        <h2 className="text-sm font-medium text-neutral-200 inline-flex items-center gap-1.5">
          Location
          <FieldHelp concept="section_location" />
        </h2>
      </header>

      <EvidenceUploader lockedMedia={lockedMedia} files={files} setFiles={setFiles} />

      {showCoords && (
        <>
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
                className={`${FORM_INPUT} font-mono`}
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
                className={`${FORM_INPUT} font-mono`}
              />
            </div>
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
        </>
      )}
    </section>
  );
}
