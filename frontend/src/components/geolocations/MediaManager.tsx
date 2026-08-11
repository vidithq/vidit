"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

import { FileManager, type FileManagerItem } from "@/components/ui/FileManager";
import { MediaDownloadButton } from "@/components/ui/MediaDownloadButton";
import { MediaLightboxBody } from "@/components/ui/MediaLightbox";
import { ACCEPTED_MEDIA_MIME } from "@/lib/mediaTypes";
import { displayUrlsFor } from "@/lib/mediaUrls";
import type { Media } from "@/types";

interface MediaManagerProps {
  /** Persisted media (the detection edit form, or a request's locked media).
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
  /** Read-only (request fulfilment): show existing media, no add / remove. */
  locked?: boolean;
}

/**
 * The source-media control, shared by the submit form (`LocationPicker`) and the
 * detection edit form so the two can't drift. A thin specialisation of the
 * generic [`FileManager`](../ui/FileManager.tsx): it supplies the media
 * thumbnails (persisted + locally-staged) as items, FileManager owns the grid,
 * the add tile, drag-drop, and the remove chrome. Object URLs for staged files
 * are revoked on change / unmount so a clear → re-pick cycle doesn't leak blobs.
 *
 * **One source per event.** An event carries at most one `source` media (the
 * backend enforces it with a partial unique index). So this is a single-file
 * picker: the add tile disappears once a source is present (kept existing or
 * staged), and the analyst removes the current one to swap it. `FileManager`'s
 * `multiple={false}` also caps a multi-file drop to the first file.
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

  const items: FileManagerItem[] = [
    ...visibleExisting.map((m) => ({
      key: m.id,
      content:
        m.media_type === "image" ? (
          <Image
            src={displayUrlsFor(m).thumbnail}
            alt=""
            fill
            sizes="200px"
            className="object-cover"
          />
        ) : (
          <video
            src={`${m.storage_url}#t=0.1`}
            preload="metadata"
            playsInline
            className="h-full w-full object-cover"
            muted
          />
        ),
      onRemove: !locked && onRemoveExisting ? () => onRemoveExisting(m.id) : undefined,
      removeLabel: "Remove media",
      // The tile itself is a muted, cropped preview; the lightbox is where a
      // persisted source is actually reviewable, same as the read-only detail
      // page's MediaGallery (playable video, uncropped image), so editing a
      // detection doesn't lose the ability to watch/inspect its source media.
      // It is literally the same viewer: `MediaLightboxBody` inside
      // FileManager's shared `MediaOverlay` shell.
      viewContent: <MediaLightboxBody source={m} />,
      // A clip's download sits in the player's own control bar, so only an
      // image needs one in the overlay corner (same rule as MediaLightbox).
      viewActions:
        m.media_type === "image" ? <MediaDownloadButton source={m} /> : undefined,
      viewLabel: m.media_type === "image" ? "View image" : "Play video",
    })),
    // Render staged tiles only once their object URLs line up 1:1, else a brief
    // mismatch flashes a broken preview.
    ...(stagedUrls.length === staged.length
      ? staged.map((f, i) => ({
          key: `${f.name}-${i}`,
          content: f.type.startsWith("video/") ? (
            <video
              src={`${stagedUrls[i]}#t=0.1`}
              preload="metadata"
              playsInline
              className="h-full w-full object-cover"
              muted
            />
          ) : (
            // Object-URL bytes can't round-trip Next's image optimiser.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={stagedUrls[i]} alt={f.name} className="h-full w-full object-cover" />
          ),
          onRemove: onRemoveStaged ? () => onRemoveStaged(i) : undefined,
          removeLabel: "Remove file",
          // A staged file has no id and no derivatives, so it reaches the same
          // viewer through the plain `{src, kind}` source shape.
          viewContent: (
            <MediaLightboxBody
              source={{
                src: stagedUrls[i],
                kind: f.type.startsWith("video/") ? "video" : "image",
                filename: f.name,
              }}
              alt={f.name}
            />
          ),
          viewLabel: f.type.startsWith("video/") ? "Play video" : "View image",
        }))
      : []),
  ];

  return (
    <FileManager
      items={items}
      onAddFiles={locked ? undefined : onAddFiles}
      accept={ACCEPTED_MEDIA_MIME}
      // One source per event: single-file picker. The add tile hides once a
      // source is present (existing or staged), so a second can't be staged.
      addLabel="Add media"
      layout="grid"
    />
  );
}
