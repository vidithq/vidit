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
      <header>
        <h2 className="text-sm font-medium text-neutral-200 inline-flex items-center gap-1.5">
          Source media
          <FieldHelp text={FIELD_HELP.source_media} label="What is the source media?" />
          {lockedMedia && <LockedHint />}
        </h2>
      </header>

      {lockedMedia ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {lockedMedia.map((m) => (
            <div
              key={m.id}
              className="relative aspect-video rounded-md overflow-hidden bg-neutral-800 border border-neutral-800"
            >
              {m.media_type === "image" ? (
                // 3-up grid ≈ 250 CSS px wide, so ``thumbnail`` fits and
                // keeps this preview (re-fetched on every landing) cheap.
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
