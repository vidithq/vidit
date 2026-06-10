"use client";

import type { ChangeEvent } from "react";

import { displayUrlsFor } from "@/lib/mediaUrls";
import { FORM_LABEL } from "@/components/ui/form-styles";
import { FilePreviewGrid } from "@/components/ui/FilePreviewGrid";
import type { BountyDetail } from "@/types";
import { LockedHint } from "./LockedHint";

interface EvidenceUploaderProps {
  /** Non-null in bounty-fulfilment mode: the bounty's media renders as
   *  a read-only preview grid instead of the file input (it transfers
   *  to the geolocation server-side on submit). */
  lockedMedia: BountyDetail["media"] | null;
  files: File[];
  setFiles: (files: File[]) => void;
}

/** The "Source media" section: the original footage being geolocated —
 *  a file input with previews, or the locked bounty media grid. */
export function EvidenceUploader({
  lockedMedia,
  files,
  setFiles,
}: EvidenceUploaderProps) {
  const handleFiles = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files));
    }
  };

  return (
    <section className="bg-neutral-900 rounded-lg border border-neutral-700 p-5 space-y-4">
      <header className="space-y-1">
        <h2 className="text-sm font-medium text-neutral-200">
          Source media {lockedMedia && <LockedHint />}
        </h2>
        <p className="text-xs text-neutral-500">
          {lockedMedia
            ? "The bounty's media transfers to this geolocation on submit. No need to re-upload."
            : "The original footage being geolocated (typically a video). Analyst-annotated screenshots belong in the proof section below."}
        </p>
      </header>

      {lockedMedia ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {lockedMedia.map((m) => (
            <div
              key={m.id}
              className="relative aspect-video rounded-md overflow-hidden bg-neutral-800 border border-neutral-800"
            >
              {m.media_type === "image" ? (
                // 3-up grid inside max-w-4xl ≈ 250 CSS px wide.
                // ``thumbnail`` is the right fit and keeps the
                // submit-form preview cheap (re-fetched on every
                // bounty-fulfilment landing).
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={displayUrlsFor(m).thumbnail}
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : (
                <video
                  src={m.storage_url}
                  className="w-full h-full object-cover"
                  muted
                />
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="files" className={FORM_LABEL}>
              Files
            </label>
            <input
              id="files"
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
              onChange={handleFiles}
              className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-md text-neutral-300 text-sm file:mr-4 file:py-1 file:px-3 file:rounded-sm file:border-0 file:bg-neutral-700 file:text-neutral-300 file:cursor-pointer"
            />
          </div>
          {files.length > 0 && (
            <FilePreviewGrid files={files} />
          )}
        </div>
      )}
    </section>
  );
}
