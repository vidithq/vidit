"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

import { FileManager, type FileManagerItem } from "@/components/ui/FileManager";
import { MediaDownloadButton } from "@/components/ui/MediaDownloadButton";
import { MediaLightboxBody } from "@/components/ui/MediaLightbox";
import { ACCEPTED_MEDIA_MIME } from "@/lib/mediaTypes";
import { displayUrlsFor, posterFrameUrl } from "@/lib/mediaUrls";
import type { Media } from "@/types";

interface MediaManagerProps {
  /** Persisted media; empty for a fresh submit. */
  existing?: Media[];
  /** Existing media marked for removal: hidden from the grid, applied on save. */
  removedIds?: ReadonlySet<string>;
  /** Omit (with `locked`) for read-only. */
  onRemoveExisting?: (id: string) => void;
  /** New files staged for upload, with a local preview. */
  staged: File[];
  onAddFiles?: (files: File[]) => void;
  onRemoveStaged?: (index: number) => void;
  /** Read-only (request fulfilment): show existing media, no add / remove. */
  locked?: boolean;
  /** Covers the persisted tiles with the age gate. Staged files stay ungated:
   *  the analyst chose them. */
  isGraphic?: boolean;
}

/**
 * The source-media control, shared by the submit form (`LocationPicker`) and the
 * detection edit form. A thin specialisation of `FileManager`: it supplies the
 * thumbnails (persisted and staged) as items. Staged object URLs are revoked on
 * change and unmount.
 *
 * **One source per event** (the backend enforces it with a partial unique
 * index), so this is a single-file picker: the add tile disappears once a source
 * is present, and the analyst removes it to swap. `multiple={false}` also caps a
 * multi-file drop to the first file.
 */
export function MediaManager({
  existing = [],
  removedIds,
  onRemoveExisting,
  staged,
  onAddFiles,
  onRemoveStaged,
  locked = false,
  isGraphic = false,
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
            src={posterFrameUrl(m.storage_url)}
            preload="metadata"
            playsInline
            className="h-full w-full object-cover"
            muted
          />
        ),
      onRemove: !locked && onRemoveExisting ? () => onRemoveExisting(m.id) : undefined,
      removeLabel: "Remove media",
      // The tile is a muted, cropped preview; the lightbox (the same
      // `MediaLightboxBody` viewer) is where the source is reviewable.
      viewContent: <MediaLightboxBody source={m} />,
      // A clip's download is in the player's bar (same rule as MediaLightbox).
      viewActions:
        m.media_type === "image" ? <MediaDownloadButton source={m} /> : undefined,
      viewLabel: m.media_type === "image" ? "View image" : "Play video",
      gated: isGraphic,
    })),
    // Only once the object URLs line up 1:1, else a broken preview flashes.
    ...(stagedUrls.length === staged.length
      ? staged.map((f, i) => ({
          key: `${f.name}-${i}`,
          content: f.type.startsWith("video/") ? (
            <video
              src={posterFrameUrl(stagedUrls[i])}
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
          // No id or derivatives: the plain `{src, kind}` source shape.
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
      addLabel="Add media"
      layout="grid"
    />
  );
}
