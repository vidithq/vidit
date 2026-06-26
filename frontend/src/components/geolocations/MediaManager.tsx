"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Plus, X } from "lucide-react";

import { ACCEPTED_MEDIA_MIME } from "@/lib/mediaTypes";
import { displayUrlsFor } from "@/lib/mediaUrls";
import type { Media } from "@/types";

interface MediaManagerProps {
  /** Persisted media (the detection edit form, or a bounty's locked media).
   *  Empty for a fresh submit. */
  existing?: Media[];
  /** Ids of existing media the owner marked for removal — hidden from the grid,
   *  applied on save. */
  removedIds?: ReadonlySet<string>;
  /** Mark an existing media for removal. Omit (with `locked`) for read-only. */
  onRemoveExisting?: (id: string) => void;
  /** New files staged for upload, shown with a local preview. */
  staged: File[];
  onAddFiles?: (files: File[]) => void;
  onRemoveStaged?: (index: number) => void;
  /** Read-only (bounty fulfilment): show existing media, no add / remove. */
  locked?: boolean;
}

/**
 * The source-media control, shared by the submit form (`LocationPicker`) and the
 * detection edit form so the two can't drift. One grid of thumbnails — persisted
 * media + locally-staged files — each removable, plus an "add" tile. Submit
 * stages files for one upload-on-submit; edit stages new files + marks existing
 * for removal, all applied on save. Object URLs for staged files are revoked on
 * change / unmount so a clear → re-pick cycle doesn't leak blobs.
 */
export function MediaManager({
  existing = [],
  removedIds,
  onRemoveExisting,
  staged,
  onAddFiles,
  onRemoveStaged,
  locked = false,
}: MediaManagerProps) {
  const [stagedUrls, setStagedUrls] = useState<string[]>([]);
  useEffect(() => {
    const made = staged.map((f) => URL.createObjectURL(f));
    setStagedUrls(made);
    return () => {
      for (const u of made) URL.revokeObjectURL(u);
    };
  }, [staged]);

  const visibleExisting = existing.filter((m) => !removedIds?.has(m.id));

  const onInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    // Reset so re-picking the same file still fires onChange.
    e.target.value = "";
    if (files.length > 0) onAddFiles?.(files);
  };

  const removeButton = (onClick: () => void, label: string) => (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-full bg-neutral-950/80 text-neutral-300 hover:bg-neutral-950 hover:text-red-400 transition-colors"
    >
      <X size={13} />
    </button>
  );

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {visibleExisting.map((m) => (
        <div
          key={m.id}
          className="relative aspect-video rounded-md overflow-hidden border border-neutral-700 bg-neutral-950"
        >
          {m.media_type === "image" ? (
            <Image
              src={displayUrlsFor(m).thumbnail}
              alt=""
              fill
              sizes="200px"
              className="object-cover"
            />
          ) : (
            <video src={m.storage_url} className="w-full h-full object-cover" muted />
          )}
          {!locked && onRemoveExisting && removeButton(() => onRemoveExisting(m.id), "Remove media")}
        </div>
      ))}

      {stagedUrls.length === staged.length &&
        staged.map((f, i) => (
          <div
            key={`${f.name}-${i}`}
            className="relative aspect-video rounded-md overflow-hidden border border-neutral-700 bg-neutral-950"
          >
            {f.type.startsWith("video/") ? (
              <video src={stagedUrls[i]} className="w-full h-full object-cover" muted />
            ) : (
              // Object-URL bytes can't round-trip Next's image optimiser.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={stagedUrls[i]} alt={f.name} className="w-full h-full object-cover" />
            )}
            {onRemoveStaged && removeButton(() => onRemoveStaged(i), "Remove file")}
          </div>
        ))}

      {!locked && onAddFiles && (
        // Clickable ⇒ orange (design rule): orange dashed border + orange `+` and
        // label. Background stays neutral so it reads as a drop-zone, not a button.
        <label className="flex aspect-video cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-orange-500/40 bg-neutral-950 text-orange-400 hover:border-orange-500/60 hover:text-orange-300 transition-colors">
          <input
            type="file"
            multiple
            accept={ACCEPTED_MEDIA_MIME}
            className="hidden"
            onChange={onInput}
          />
          <Plus size={18} />
          <span className="text-xs">Add media</span>
        </label>
      )}
    </div>
  );
}
