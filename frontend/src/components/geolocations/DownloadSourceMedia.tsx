"use client";

import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";

import { ApiError, apiFetch } from "@/lib/api";
import {
  fetchFirstMediaFile,
  isXStatusUrl,
  sourceMediaCandidates,
  tweetIdFrom,
} from "@/lib/tweetImport";
import { Button } from "@/components/ui/Button";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import type { TweetImportResponse } from "@/types";

/**
 * Pulls the source post's media into the form's staged media, for a detection
 * whose source URL is an X post but whose footage never made it in (the bot
 * path stores what the mention carried, an archive import what the export
 * held). One click replaces "open the post, save the video, pick the file".
 *
 * The same two endpoints the submit form's tweet import rides: the parse
 * (`POST /events/import-from-tweet`) for the media list, then the byte proxy
 * for the first of the post's own items the CDN serves, video before image.
 * The file lands staged, exactly as a
 * hand-picked one does, and uploads with the rest of the form at submit.
 * Renders nothing unless the source URL is an X status URL, since that is all
 * the parse endpoint reads.
 */
export function DownloadSourceMedia({
  sourceUrl,
  onFile,
}: {
  sourceUrl: string;
  /** Stage the downloaded file as the event's source media. */
  onFile: (file: File) => void;
}) {
  const [busy, setBusy] = useState(false);
  // A failure is stored with the URL that produced it, and shown only while
  // that is still the URL on the form: once the analyst edits the field, the
  // banner is about a post that is no longer the target. Derived rather than
  // cleared in an effect, so the stale banner can't survive a render.
  const [failure, setFailure] = useState<{ url: string; message: string } | null>(
    null
  );
  const error = failure !== null && failure.url === sourceUrl ? failure.message : null;
  const setError = (message: string) => setFailure({ url: sourceUrl, message });
  // Aborts the in-flight parse and downloads on unmount, so a navigation
  // mid-fetch doesn't leave open sockets behind or write to a gone component.
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  if (!isXStatusUrl(sourceUrl)) return null;

  const run = async () => {
    setFailure(null);
    setBusy(true);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const parsed = await apiFetch<TweetImportResponse>(
        "/events/import-from-tweet",
        {
          method: "POST",
          body: JSON.stringify({ url: sourceUrl.trim() }),
          signal: controller.signal,
        }
      );
      // The parsed post is the source itself, so only its own media qualifies,
      // video first. See `sourceMediaCandidates`.
      const candidates = sourceMediaCandidates(parsed.media);
      if (candidates.length === 0) {
        setError("That post carries no media to download.");
        return;
      }
      const file = await fetchFirstMediaFile(
        candidates,
        tweetIdFrom(parsed.original_tweet_url),
        controller.signal
      );
      if (controller.signal.aborted) return;
      if (file === null) {
        setError("Couldn't download the media from that post. Try again, or attach the file yourself.");
        return;
      }
      onFile(file);
    } catch (err) {
      // An abort is this component's own doing (unmount, or a second click):
      // it is not a failure to report, and the component may be gone.
      if (controller.signal.aborted) return;
      // `ApiError` carries the backend's `detail` as its message, already
      // analyst-friendly English for a deleted post, a protected account, or
      // an upstream failure; render it as-is.
      setError(
        err instanceof ApiError ? err.message : "Couldn't reach that post."
      );
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button variant="secondary" onClick={run} disabled={busy}>
        <Download size={13} />
        {busy ? "Downloading…" : "Download media from source"}
      </Button>
      {error && <div className={FORM_ERROR_BANNER}>{error}</div>}
    </div>
  );
}
