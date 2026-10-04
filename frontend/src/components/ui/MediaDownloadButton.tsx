"use client";

import { useState } from "react";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { FLOATING_CONTROL } from "@/components/ui/styles";
import { cn } from "@/lib/cn";
import type { Media } from "@/types";

// A persisted `Media` row (named by `original_filename`) or a plain URL (a proof
// image, named by `filename` when given). Both fall back to the URL's basename.
export type DownloadSource = Media | { src: string; filename?: string };

function resolveDownload(source: DownloadSource): {
  url: string;
  filename: string;
} {
  const isMedia = "media_type" in source;
  const url = isMedia ? source.storage_url : source.src;
  // Each rung falls through on missing or empty ("" from an empty
  // `original_filename` or a trailing slash), which `??` would accept.
  const named = (isMedia ? source.original_filename : source.filename) ?? "";
  const basename =
    new URL(url, window.location.href).pathname.split("/").pop() ?? "";
  return { url, filename: named || basename || "media" };
}

// The download control on a media tile or lightbox corner: fetches the object as
// a blob and saves it under its resolved filename. The blob hop is required:
// media lives on a separate origin (CloudFront in prod), where `<a download>` is
// ignored. Needs the media origin to answer CORS on GET/HEAD (CloudFront's
// SimpleCORS policy; local storage inherits the backend's CORS allowlist).
// Composes `<Button icon variant="ghost">` with the `FLOATING_CONTROL` backdrop.
export function MediaDownloadButton({
  source,
  className = "",
}: {
  source: DownloadSource;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function download() {
    setBusy(true);
    setFailed(false);
    try {
      const { url, filename } = resolveDownload(source);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`download failed: ${res.status}`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      // Firefox ignores a click on a detached anchor. Revoking is deferred to a
      // macrotask: revoking in the same tick can cancel the download.
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const label = failed ? "Download failed, retry" : "Download";
  return (
    <Button
      icon
      variant="ghost"
      className={cn(
        FLOATING_CONTROL,
        failed && "text-red-400",
        className,
      )}
      aria-label={label}
      title={label}
      disabled={busy}
      onClick={download}
    >
      <Download size={16} />
    </Button>
  );
}
