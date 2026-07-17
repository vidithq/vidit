"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Clock,
  Download,
  ExternalLink,
  FileArchive,
  Scissors,
  Settings,
  ShieldCheck,
  Upload,
} from "lucide-react";

import { Button, buttonClasses } from "@/components/ui/Button";
import { ACCENT_SURFACE, TEXT_LINK } from "@/components/ui/styles";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { FileManager } from "@/components/ui/FileManager";
import { useMutation } from "@/hooks/useMutation";
import { useDetectionsCount } from "@/contexts/DetectionsContext";
import { ApiError } from "@/lib/api";
import { stripArchive } from "@/lib/archive";
import {
  ImportPollLost,
  awaitImportJob,
  enqueueArchiveImport,
  presignArchiveUpload,
  uploadArchive,
} from "@/lib/events";
import type { ArchiveImportJob } from "@/types";

/** X's official walkthrough for requesting the data archive. */
const X_ARCHIVE_HELP =
  "https://help.x.com/en/managing-your-account/how-to-download-your-x-archive";


function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const STEPS = [
  {
    icon: Settings,
    title: "Request your archive on X",
    detail: 'On X: Settings → "Your account" → "Download an archive of your data".',
  },
  {
    icon: Clock,
    title: "Wait for X to build it",
    detail:
      "Confirm your password. X prepares the file and notifies you when it's ready (often minutes, up to 24h).",
  },
  {
    icon: Download,
    title: "Download the .zip",
    detail: "Open the link from X's email or in-app banner and save the zip to your device.",
  },
  {
    icon: Scissors,
    title: "Trim it to your posts (recommended)",
    detail:
      "Open the archive and keep only your tweets.js and tweets_media folder (inside the data folder); delete the rest, then re-zip. We strip it automatically too, this is for full control.",
  },
  {
    icon: Upload,
    title: "Upload it here",
    detail: "Drop the zip below. We map the geolocations in your posts for you to review.",
  },
];

/** Map the browser strip's and the enqueue's typed errors to a human message.
 *  An upload-leg failure needs no case: `ArchiveUploadError` carries its own
 *  retryable message, which the `errorMessage` fallback surfaces as-is. */
function importErrorMessage(err: unknown): string | undefined {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "archive_too_large":
        return "That archive is over the size limit. Very large archives aren't supported yet.";
      case "archive_no_tweets":
        return "That zip isn't an X data export (no tweets.js inside).";
      case "archive_malformed":
        return "That file isn't a valid .zip archive.";
      case "archive_upload_missing":
      case "archive_upload_invalid":
        return "The uploaded archive couldn't be found on our side. Try the import again.";
    }
  }
  return undefined;
}

/**
 * The bulk-import on-ramp: the "how to export from X" guide, the drop zone (via
 * `FileManager`), the in-browser strip, the upload, and the bridge to the owner
 * Detections queue. Rendered both as the `/submit` archive sub-mode and the
 * focused entry the onboarding redirect lands on. `username` is the caller (the
 * detections queue is owner-scoped). Auth + the page chrome are the parent's job.
 */
export function ImportArchivePanel({ username }: { username: string }) {
  const router = useRouter();
  const { refresh: refreshDetectionCount } = useDetectionsCount();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ArchiveImportJob | null>(null);
  // The poll lost sight of the job (transient errors, or a very long run):
  // the import is still running server-side, so this renders a calm
  // "check your email" state, never the failure banner.
  const [pollLost, setPollLost] = useState(false);
  // Latest polled snapshot while the import runs: the post estimate stamped
  // at enqueue, then the worker's live scan position (done / total).
  const [liveJob, setLiveJob] = useState<ArchiveImportJob | null>(null);
  // Direct-to-storage upload progress, 0..1; null outside the upload leg.
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  // Strip to the allowlisted entries in the browser first, so the sensitive
  // rest of the export never leaves the device (and the upload is a fraction
  // of the size). Then the presigned three-step: mint the upload, POST the
  // zip straight to storage (never through the API), enqueue by key (202).
  // The worker service runs the import and emails the outcome, and the poll
  // below keeps this page live for the analyst who stayed.
  const { run, loading, error } = useMutation(
    async (archive: File): Promise<ArchiveImportJob | null> => {
      setLiveJob(null);
      setUploadProgress(null);
      const stripped = await stripArchive(archive);
      const presign = await presignArchiveUpload();
      await uploadArchive(presign.upload, stripped.file, setUploadProgress);
      const queued = await enqueueArchiveImport(presign.upload_key, stripped.postEstimate);
      setLiveJob(queued);
      let job: ArchiveImportJob;
      try {
        job = await awaitImportJob(queued.id, { onUpdate: setLiveJob });
      } catch (err) {
        if (err instanceof ImportPollLost) return null; // still running
        throw err;
      }
      if (job.status === "failed") {
        // Same story as the failure email and the API doc: a failed job
        // keeps whatever landed before the failure, and re-uploading skips
        // it and continues.
        throw new Error(
          "The import failed on our side. Anything imported before the failure is kept; upload the same archive again to continue from there, and reach out on Discord if it keeps failing."
        );
      }
      return job;
    },
    {
      onSuccess: (res) => {
        refreshDetectionCount();
        if (res === null) {
          setPollLost(true);
          return;
        }
        // Bridge straight to the review queue when there's fresh work to triage;
        // only stay here when nothing landed (retry) or it was all already imported.
        if (res.created > 0) {
          router.push(`/profile/${username}/detections`);
        } else {
          setResult(res);
        }
      },
      onError: importErrorMessage,
    }
  );

  if (pollLost) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-neutral-200">
          Your archive is uploaded and the import is still running in the background.
          You can leave this page: we&apos;ll email you when it finishes, and new
          detections land in your review queue as they&apos;re created.
        </p>
        <div className="flex flex-wrap gap-3 pt-1">
          <Link
            href={`/profile/${username}/detections`}
            className={buttonClasses("primary")}
          >
            Open the detections queue
          </Link>
        </div>
      </div>
    );
  }

  // Reached only when the import created nothing. Three cases: some posts failed
  // to persist (retry the same file), the archive was already fully imported
  // (offer the queue), or it simply had no geolocatable posts (pick another).
  if (result) {
    const failedSome = result.failed > 0;
    const alreadyImported = !failedSome && result.skipped > 0;
    return (
      <div className="space-y-4">
        <p className="text-sm text-neutral-200">
          {failedSome
            ? `Some posts couldn't be imported (${result.failed} failed). Try the import again.`
            : alreadyImported
              ? `Everything in that archive was already imported (${result.skipped} ${
                  result.skipped === 1 ? "geolocation" : "geolocations"
                }).`
              : "No geolocations found in that archive. Posts with a coordinate in their text become detections."}
        </p>
        <div className="flex flex-wrap gap-3 pt-1">
          {alreadyImported ? (
            <Link
              href={`/profile/${username}/detections`}
              className={buttonClasses("primary")}
            >
              Review detections
            </Link>
          ) : (
            <Button
              variant="primary"
              onClick={() => {
                setResult(null);
                if (failedSome) {
                  if (file) run(file);
                } else {
                  setFile(null);
                }
              }}
            >
              {failedSome ? "Try again" : "Choose a different file"}
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-neutral-200">How to export from X</h2>
        <ol className="space-y-2">
          {STEPS.map((step, i) => (
            <li
              key={step.title}
              className="flex items-start gap-3 rounded-lg border border-neutral-800 bg-neutral-900 p-3"
            >
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${ACCENT_SURFACE}`}>
                {i + 1}
              </span>
              <step.icon size={18} strokeWidth={1.8} className="mt-0.5 shrink-0 text-neutral-500" />
              <div className="min-w-0">
                <p className="text-sm text-neutral-200">{step.title}</p>
                <p className="text-xs text-neutral-500">{step.detail}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="inline-flex items-center gap-1.5 text-neutral-400">
            <ShieldCheck size={14} strokeWidth={1.8} className="text-neutral-500" />
            Even if you skip the trim, your browser keeps only your posts and their media before uploading; DMs, email, and phone never leave your device.
          </span>
          <a
            href={X_ARCHIVE_HELP}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center gap-1 ${TEXT_LINK}`}
          >
            {"X's guide"}
            <ExternalLink size={12} strokeWidth={2} />
          </a>
        </div>
      </section>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (file) run(file);
        }}
        className="space-y-4"
        noValidate
      >
        <FileManager
          items={
            file
              ? [
                  {
                    key: file.name,
                    content: (
                      <div className="w-60 max-w-full overflow-hidden rounded-md border border-neutral-700 bg-neutral-950">
                        <div className="flex aspect-video items-center justify-center bg-neutral-900">
                          <FileArchive size={44} strokeWidth={1.3} className="text-orange-400" />
                        </div>
                        <div className="border-t border-neutral-800 px-3 py-2">
                          <p className="truncate text-sm text-neutral-100">{file.name}</p>
                          <p className="text-xs text-neutral-500">
                            {formatBytes(file.size)} · ready to import
                          </p>
                        </div>
                      </div>
                    ),
                    onRemove: () => setFile(null),
                    removeLabel: "Remove file",
                  },
                ]
              : []
          }
          onAddFiles={(files) => setFile(files[0] ?? null)}
          accept=".zip,application/zip"
          addLabel="Choose your X archive (.zip)"
          addHint="or drag it onto this box"
          layout="stack"
        />

        {error && <div className={FORM_ERROR_BANNER}>{error}</div>}

        <Button
          type="submit"
          variant="primary"
          fullWidth
          disabled={!file || loading}
          className="sm:w-auto"
        >
          {loading ? "Importing…" : "Import archive"}
        </Button>
        {loading && (
          <div className="space-y-1.5">
            <p className="text-xs text-neutral-300">
              {liveJob === null
                ? uploadProgress === null
                  ? "Keeping only your posts, then uploading…"
                  : `Uploading your posts… ${Math.round(uploadProgress * 100)}%`
                : liveJob.progress_total !== null
                  ? `Scanning your posts… ${liveJob.progress_done} / ${liveJob.progress_total} detections processed.`
                  : `Queued · ~${(liveJob.post_estimate ?? 1).toLocaleString()} post${(liveJob.post_estimate ?? 1) === 1 ? "" : "s"} in your archive, waiting for the importer.`}
            </p>
            <p className="text-xs text-neutral-500">
              You can close this page: the import keeps running and we email you
              when it finishes.
            </p>
          </div>
        )}
      </form>
    </div>
  );
}
