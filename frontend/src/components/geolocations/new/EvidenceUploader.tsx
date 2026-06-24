"use client";

import type { ChangeEvent } from "react";

import { displayUrlsFor } from "@/lib/mediaUrls";
import { FORM_LABEL } from "@/components/ui/form-styles";
import FieldHelp from "@/components/ui/FieldHelp";
import { FilePreviewGrid } from "@/components/ui/FilePreviewGrid";
import { FIELD_HELP } from "@/lib/fieldHelp";
import type { BountyDetail } from "@/types";
import { LockedHint } from "./LockedHint";

interface EvidenceUploaderProps {
  /** Non-null in bounty-fulfilment mode: renders a read-only preview grid
   *  instead of the file input; the media transfers server-side on submit. */
  lockedMedia: BountyDetail["media"] | null;
  files: File[];
  setFiles: (files: File[]) => void;
  /** Render the "Source media" label + `?`. Off when the host section already
   *  carries that heading (the bounty form's standalone media section). */
  showLabel?: boolean;
}

/** The source-media control: the original footage being geolocated — a file
 *  input with previews, or the locked bounty-media grid. Section-less so it can
 *  sit inside the geolocation form's "Location" block or the bounty form's
 *  "Source media" section. */
export function EvidenceUploader({
  lockedMedia,
  files,
  setFiles,
  showLabel = true,
}: EvidenceUploaderProps) {
  const handleFiles = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files));
    }
  };

  const control = lockedMedia ? (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {lockedMedia.map((m) => (
        <div
          key={m.id}
          className="relative aspect-video rounded-md overflow-hidden bg-neutral-800 border border-neutral-800"
        >
          {m.media_type === "image" ? (
            // 3-up grid ≈ 250 CSS px wide, so ``thumbnail`` fits and keeps this
            // preview (re-fetched on every landing) cheap.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={displayUrlsFor(m).thumbnail}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            <video src={m.storage_url} className="w-full h-full object-cover" muted />
          )}
        </div>
      ))}
    </div>
  ) : (
    <div className="space-y-3">
      <input
        id="files"
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
        onChange={handleFiles}
        className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-md text-neutral-300 text-sm file:mr-4 file:py-1 file:px-3 file:rounded-sm file:border-0 file:bg-neutral-700 file:text-neutral-300 file:cursor-pointer"
      />
      {files.length > 0 && <FilePreviewGrid files={files} />}
    </div>
  );

  if (!showLabel) return control;

  return (
    <div className="space-y-1.5">
      <span className={FORM_LABEL}>
        Source media{" "}
        <FieldHelp text={FIELD_HELP.source_media} label="What is the source media?" />
        {lockedMedia && <LockedHint />}
      </span>
      {control}
    </div>
  );
}
