"use client";

import { useState } from "react";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { FLOATING_CONTROL } from "@/components/ui/styles";
import { cn } from "@/lib/cn";
import type { Media } from "@/types";

// What the control can save: a persisted `Media` row (named by its
// `original_filename`), or any plain URL (a proof image), named by an explicit
// `filename` when given. Both fall back to the URL's basename.
export type DownloadSource = Media | { src: string; filename?: string };

function resolveDownload(source: DownloadSource): {
  url: string;
  filename: string;
} {
  const isMedia = "media_type" in source;
  const url = isMedia ? source.storage_url : source.src;
  // Each rung falls through when it is missing *or* empty: a row whose
  // `original_filename` is the empty string, and a URL whose path ends in a
  // slash, both yield "", which `??` would have accepted and handed to
  // `a.download` as a nameless save.
  const named = (isMedia ? source.original_filename : source.filename) ?? "";
  const basename =
    new URL(url, window.location.href).pathname.split("/").pop() ?? "";
  return { url, filename: named || basename || "media" };
}

// The download control on a media tile or a lightbox corner: fetches the
// object as a blob and saves it under its resolved filename. The blob hop is
// required, not a nicety: media lives on a separate origin (CloudFront in
// prod), where a plain `<a download>` is ignored and navigates to the file
// instead of saving it. Requires the media origin to answer CORS on GET/HEAD
// (the CloudFront distribution carries the SimpleCORS response headers policy;
// local storage inherits the backend's CORS allowlist).
// Composes `<Button icon variant="ghost">`; the translucent backdrop keeps the
// glyph readable over whatever frame it floats on.
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
      // Firefox ignores a synthetic click on an anchor that is not in the
      // document, so the link is attached for the click and taken straight
      // back out. Revoking is deferred to a macrotask for the same reason it
      // is attached: the save is kicked off by the click but not finished by
      // the time it returns, and pulling the object URL out from under it in
      // the same tick can cancel the download.
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
