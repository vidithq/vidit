"use client";

import { useEffect, useState } from "react";

/**
 * Thumbnail strip for files queued in a submit form, before upload. Object URLs
 * are revoked on unmount and whenever the file list changes, so a
 * "clear → re-pick" cycle (e.g. tweet-import) doesn't leak blob URLs.
 * Shared by the geolocation + bounty forms; contract is just `File[]`.
 */
export function FilePreviewGrid({ files }: { files: File[] }) {
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    const made = files.map((f) => URL.createObjectURL(f));
    setUrls(made);
    return () => {
      for (const u of made) URL.revokeObjectURL(u);
    };
  }, [files]);
  if (urls.length !== files.length) return null;
  return (
    <div>
      <p className="text-xs text-neutral-500 mb-2">
        {files.length} file{files.length > 1 ? "s" : ""} ready to upload
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {files.map((f, i) => (
          <div
            key={`${f.name}-${i}`}
            className="relative aspect-video rounded-md overflow-hidden bg-neutral-800 border border-neutral-800"
          >
            {f.type.startsWith("video/") ? (
              <video
                src={urls[i]}
                className="w-full h-full object-cover"
                muted
                controls
                preload="metadata"
              />
            ) : (
              // Object-URL bytes can't round-trip through Next's image
              // optimiser, so a plain <img> is required here.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={urls[i]}
                alt={f.name}
                className="w-full h-full object-cover"
              />
            )}
            <div className="absolute bottom-0 inset-x-0 bg-linear-to-t from-black/80 to-transparent px-2 py-1">
              <p className="truncate text-[10px] text-neutral-200">{f.name}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
