"use client";

import type { ChangeEvent } from "react";

import { displayUrlsFor } from "@/lib/mediaUrls";
import { FORM_LABEL } from "@/components/ui/form-styles";
import FieldHelp from "@/components/ui/FieldHelp";
import { FilePreviewGrid } from "@/components/ui/FilePreviewGrid";
import type { BountyDetail } from "@/types";
import { LockedHint } from "./LockedHint";

interface EvidenceUploaderProps {
  /** Non-null in bounty-fulfilment mode: renders a read-only preview grid
   *  instead of the file input; the media transfers server-side on submit. */
  lockedMedia: BountyDetail["media"] | null;
  files: File[];
  setFiles: (files: File[]) => void;
}

/** The source-media control: the original footage being geolocated, as a file
 *  input with previews, or the locked bounty-media grid. Section-less so it sits
 *  inside the "Location" block in both submit modes. */
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

  return (
    <div className="space-y-1.5">
      {lockedMedia ? (
        // Locked-media mode renders a preview grid, not an input, so there's
        // no control to associate a label with.
        <span className={FORM_LABEL}>
          Source media <FieldHelp concept="source_media" />
          <LockedHint />
        </span>
      ) : (
        <label htmlFor="files" className={FORM_LABEL}>
          Source media <FieldHelp concept="source_media" />
        </label>
      )}
      {control}
    </div>
  );
}
