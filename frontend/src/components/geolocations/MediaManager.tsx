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
  /** The stored or staged file, or a picked file while it uploads; null while the source has
   *  none. */
  file: Media | File | null;
  /** Omit for a file that stays. */
  onRemove?: () => void;
  /** Omit once the source holds a file: the analyst removes it to swap. */
  onAdd?: (file: File) => void;
  /** Covers the stored tile with the age gate. A picked file stays ungated: the analyst
   *  chose it. */
  isGraphic?: boolean;
}

/**
 * One source's file slot, in each `SourceEditor`. A thin specialisation of `FileManager`: it
 * supplies the thumbnail of the source's one file as its item. A picked file previews from an
 * object URL, revoked on change and unmount.
 */
export function MediaManager({ file, onRemove, onAdd, isGraphic = false }: MediaManagerProps) {
  const picked = file instanceof File ? file : null;
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(null);
  useEffect(() => {
    if (!picked) return;
    const url = URL.createObjectURL(picked);
    setPreview({ file: picked, url });
    return () => URL.revokeObjectURL(url);
  }, [picked]);
  // Only once the object URL is the picked file's, else a broken preview flashes.
  const pickedUrl = picked && preview?.file === picked ? preview.url : null;

  let item: FileManagerItem | null = null;
  if (file && !(file instanceof File)) {
    item = {
      key: file.id,
      content:
        file.kind === "image" ? (
          <Image
            src={displayUrlsFor(file).hero}
            alt=""
            fill
            sizes="(min-width: 768px) 50vw, 100vw"
            className="object-cover"
          />
        ) : (
          <VideoTile src={file.storage_url} />
        ),
      onRemove,
      removeLabel: "Remove media",
      // The tile is a muted, cropped preview; the lightbox (the same
      // `MediaLightboxBody` viewer) is where the source is reviewable.
      viewContent: <MediaLightboxBody source={file} />,
      // A clip's download is in the player's bar (same rule as MediaLightbox).
      viewActions: file.kind === "image" ? <MediaDownloadButton source={file} /> : undefined,
      viewLabel: file.kind === "image" ? "View image" : "Play video",
      gated: isGraphic,
    };
  } else if (picked && pickedUrl) {
    const video = picked.type.startsWith("video/");
    item = {
      key: `${picked.name}-0`,
      content: video ? (
        <VideoTile src={pickedUrl} />
      ) : (
        // Object-URL bytes can't round-trip Next's image optimiser.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={pickedUrl} alt={picked.name} className="h-full w-full object-cover" />
      ),
      onRemove,
      removeLabel: "Remove file",
      // No id or derivatives: the plain `{src, kind}` source shape.
      viewContent: (
        <MediaLightboxBody
          source={{ src: pickedUrl, kind: video ? "video" : "image", filename: picked.name }}
          alt={picked.name}
        />
      ),
      viewLabel: video ? "Play video" : "View image",
    };
  }

  return (
    <FileManager
      items={item ? [item] : []}
      onAddFiles={onAdd && ((files) => onAdd(files[0]))}
      accept={ACCEPTED_MEDIA_MIME}
      addLabel="Add media"
      layout="grid"
    />
  );
}
