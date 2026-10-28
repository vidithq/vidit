"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

import { FileManager, type FileManagerItem } from "@/components/ui/FileManager";
import { MediaDownloadButton } from "@/components/ui/MediaDownloadButton";
import { MediaLightboxBody } from "@/components/ui/MediaLightbox";
import { FILE_UNAVAILABLE, TileNotice } from "@/components/ui/TileNotice";
import { ACCEPTED_MEDIA_MIME } from "@/lib/mediaTypes";
import { displayUrlsFor, posterFrameUrl } from "@/lib/mediaUrls";
import type { Media } from "@/types";

/** A clip's muted, cropped tile. A file that does not load says so, rather than a black box. */
function VideoTile({ src }: { src: string }) {
  // The failed URL, not a flag: comparing to `src` resets the verdict on a swap.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (failedSrc === src) return <TileNotice>{FILE_UNAVAILABLE}</TileNotice>;
  return (
    <video
      src={posterFrameUrl(src)}
      preload="metadata"
      playsInline
      className="h-full w-full object-cover"
      muted
      onError={() => setFailedSrc(src)}
    />
  );
}

interface MediaManagerProps {
  /** The stored or staged file; empty while the source has none. */
  existing?: Media[];
  /** Omit for a file that stays. */
  onRemoveExisting?: (id: string) => void;
  /** A picked file while it uploads, with a local preview. */
  staged: File[];
  onAddFiles?: (files: File[]) => void;
  onRemoveStaged?: (index: number) => void;
  /** Covers the stored tile with the age gate. A picked file stays ungated: the analyst
   *  chose it. */
  isGraphic?: boolean;
}

/**
 * One source's file slot, in each `SourceEditor`. A thin specialisation of `FileManager`: it
 * supplies the thumbnails (a stored or staged file, or a picked file while it uploads) as items.
 * Staged object URLs are revoked on change and unmount.
 *
 * **One file per source**, so this is a single-file picker: the caller withholds `onAddFiles`
 * once the source holds a file, and the analyst removes it to swap. `multiple={false}` also caps
 * a multi-file drop to the first file.
 */
export function MediaManager({
  existing = [],
  onRemoveExisting,
  staged,
  onAddFiles,
  onRemoveStaged,
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

  const items: FileManagerItem[] = [
    ...existing.map((m) => ({
      key: m.id,
      content:
        m.kind === "image" ? (
          <Image
            src={displayUrlsFor(m).hero}
            alt=""
            fill
            sizes="(min-width: 768px) 50vw, 100vw"
            className="object-cover"
          />
        ) : (
          <VideoTile src={m.storage_url} />
        ),
      onRemove: onRemoveExisting ? () => onRemoveExisting(m.id) : undefined,
      removeLabel: "Remove media",
      // The tile is a muted, cropped preview; the lightbox (the same
      // `MediaLightboxBody` viewer) is where the source is reviewable.
      viewContent: <MediaLightboxBody source={m} />,
      // A clip's download is in the player's bar (same rule as MediaLightbox).
      viewActions:
        m.kind === "image" ? <MediaDownloadButton source={m} /> : undefined,
      viewLabel: m.kind === "image" ? "View image" : "Play video",
      gated: isGraphic,
    })),
    // Only once the object URLs line up 1:1, else a broken preview flashes.
    ...(stagedUrls.length === staged.length
      ? staged.map((f, i) => ({
          key: `${f.name}-${i}`,
          content: f.type.startsWith("video/") ? (
            <VideoTile src={stagedUrls[i]} />
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
      onAddFiles={onAddFiles}
      accept={ACCEPTED_MEDIA_MIME}
      addLabel="Add media"
      layout="grid"
    />
  );
}
