"use client";

import { useState } from "react";
import Link from "next/link";
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
import { ProgressSteps } from "@/components/ui/ProgressSteps";
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
        return "That archive is over the 2 GB safety limit. Get in touch and we'll find a way to import it.";
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

/** Where the import run currently is; indexes `IMPORT_STEP_LABELS`. `strip`
 *  and `upload` are client legs, `queued` and `scanning` follow the polled
 *  job, `done` is the terminal in-place state (the completed stepper stays
 *  up, with the review CTA under it). */
type ImportPhase = "strip" | "upload" | "queued" | "scanning" | "done";

const IMPORT_PHASE_INDEX: Record<ImportPhase, number> = {
  strip: 0,
  upload: 1,
  queued: 2,
  scanning: 3,
  // Past the last index: every step renders complete.
  done: 5,
};

const IMPORT_STEP_LABELS = [
  "Filtering out private data",
  "Uploading your archive",
  "Queued for import",
  "Extracting geolocations",
  "Done",
];

/** Real megabyte rendering for the upload counter: one decimal below 100 MB,
 *  whole (locale-grouped) megabytes above. */
function formatMB(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb < 100 ? mb.toFixed(1) : Math.round(mb).toLocaleString()} MB`;
}

/**
 * The bulk-import on-ramp: the "how to export from X" guide, the drop zone (via
 * `FileManager`), the in-browser strip, the upload, and the bridge to the owner
 * Detections queue. Rendered both as the `/submit` archive sub-mode and the
 * focused entry the onboarding redirect lands on. `username` is the caller (the
 * detections queue is owner-scoped). Auth + the page chrome are the parent's job.
 */
export function ImportArchivePanel({ username }: { username: string }) {
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
  // Direct-to-storage upload position in raw bytes (multipart envelope
  // included); null outside the upload leg.
  const [uploadBytes, setUploadBytes] = useState<{ loaded: number; total: number } | null>(null);
  // The run's position in IMPORT_STEP_LABELS. Advanced as each leg starts,
  // and kept after a failure so the error lands on the step that raised it.
  const [phase, setPhase] = useState<ImportPhase>("strip");

  // Strip to the allowlisted entries in the browser first, so the sensitive
  // rest of the export never leaves the device (and the upload is a fraction
  // of the size). Then the presigned three-step: mint the upload, POST the
  // zip straight to storage (never through the API), enqueue by key (202).
  // The worker service runs the import and emails the outcome, and the poll
  // below keeps this page live for the analyst who stayed.
  const { run, loading, error } = useMutation(
    async (archive: File): Promise<ArchiveImportJob | null> => {
      setLiveJob(null);
      setUploadBytes(null);
      setPhase("strip");
      const stripped = await stripArchive(archive);
      setPhase("upload");
      // Real numbers from the first frame: the stripped size is the known
      // payload, refined by the first XHR progress event (envelope included).
      setUploadBytes({ loaded: 0, total: stripped.file.size });
      const presign = await presignArchiveUpload();
      await uploadArchive(presign.upload, stripped.file, (loaded, total) =>
        setUploadBytes({ loaded, total })
      );
      const queued = await enqueueArchiveImport(presign.upload_key, stripped.postEstimate);
      setPhase("queued");
      setLiveJob(queued);
      const onUpdate = (job: ArchiveImportJob) => {
        setLiveJob(job);
        // The worker picked the job up: "queued" is over, the extraction is live.
        if (job.status !== "queued") setPhase("scanning");
      };
      let job: ArchiveImportJob;
      try {
        job = await awaitImportJob(queued.id, { onUpdate });
      } catch (err) {
        if (err instanceof ImportPollLost) return null; // still running
        throw err;
      }
      if (job.status === "done") {
        // The completed stepper stays on screen as the receipt of the run;
        // the CTA below it bridges to the review queue (no auto-redirect).
        setPhase("done");
        setLiveJob(job);
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
        // Fresh drafts landed: stay on the page. The finished stepper is the
        // receipt of the run and the CTA under it opens the review queue.
        // Only the zero-created outcomes swap to the result view (retry, or
        // it was all already imported).
        if (res.created === 0) setResult(res);
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

  // Zero-created outcomes (`result`) render UNDER the completed stepper like
  // the happy path, never as a swapped-out bare view: the stepper stays as
  // the receipt of what ran, the message + action below it say what's next.
  const failedSome = (result?.failed ?? 0) > 0;
  const alreadyImported = result !== null && !failedSome && result.skipped > 0;

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
        {(loading || error || phase === "done") && (
          <div className="space-y-3 rounded-lg border border-neutral-800 bg-neutral-900 p-4">
            <ProgressSteps
              steps={[
                {
                  label: IMPORT_STEP_LABELS[0],
                  detail: "DMs, messages and account data never leave your device.",
                  keepDetail: true,
                  spinner: true,
                },
                {
                  label: IMPORT_STEP_LABELS[1],
                  ...(uploadBytes !== null
                    ? {
                        progress:
                          uploadBytes.total > 0 ? uploadBytes.loaded / uploadBytes.total : 0,
                        detail: `${formatMB(uploadBytes.loaded)} of ${formatMB(uploadBytes.total)}`,
                      }
                    : {}),
                },
                {
                  label: IMPORT_STEP_LABELS[2],
                  spinner: true,
                  detail: `~${(liveJob?.post_estimate ?? 1).toLocaleString()} post${
                    (liveJob?.post_estimate ?? 1) === 1 ? "" : "s"
                  } in your archive.`,
                },
                {
                  label: IMPORT_STEP_LABELS[3],
                  // The worker runs two legs: the parse over tweets.js (no
                  // ratio yet, `progress_total` still null), then the
                  // per-detection persist the polled counts measure.
                  ...(liveJob && liveJob.progress_total !== null
                    ? {
                        progress:
                          liveJob.progress_total > 0
                            ? liveJob.progress_done / liveJob.progress_total
                            : 1,
                        detail:
                          `${liveJob.progress_done.toLocaleString()} of ${liveJob.progress_total.toLocaleString()} geolocation${
                            liveJob.progress_total === 1 ? "" : "s"
                          } extracted` +
                          (liveJob.post_estimate !== null
                            ? ` · from ~${liveJob.post_estimate.toLocaleString()} posts`
                            : ""),
                      }
                    : { spinner: true, detail: "Reading your posts…" }),
                },
                {
                  label: IMPORT_STEP_LABELS[4],
                  keepDetail: true,
                  ...(phase === "done" && liveJob
                    ? {
                        detail:
                          `${liveJob.created.toLocaleString()} draft${
                            liveJob.created === 1 ? "" : "s"
                          } ready for review` +
                          (liveJob.skipped > 0
                            ? ` · ${liveJob.skipped.toLocaleString()} skipped (already imported)`
                            : ""),
                      }
                    : {}),
                },
              ]}
              active={IMPORT_PHASE_INDEX[phase]}
              failed={!loading && error !== null}
            />
            {/* Only once the enqueue has landed: from here the import runs
                server-side, while closing during the strip or the upload
                would abort the transfer. */}
            {loading && (phase === "queued" || phase === "scanning") && (
              <p className="text-xs text-neutral-500">
                You can close this page, we email you when it&apos;s done.
              </p>
            )}
            {/* Finished: the completed stepper above is the receipt, this is
                the next step. In place on purpose (no auto-redirect), for the
                zero-created outcomes too: retry the same file after partial
                failures, the queue when it was all already imported, another
                file when nothing was geolocatable. */}
            {!loading && phase === "done" && (
              <div className="space-y-3 pt-1">
                {result && (
                  <p className="text-sm text-neutral-200">
                    {failedSome
                      ? `Some posts couldn't be imported (${result.failed} failed). Try the import again.`
                      : alreadyImported
                        ? `Everything in that archive was already imported (${result.skipped} ${
                            result.skipped === 1 ? "geolocation" : "geolocations"
                          }).`
                        : "No geolocations found in that archive. Posts with a coordinate in their text become detections."}
                  </p>
                )}
                <div className="flex flex-wrap gap-3">
                  {!result || alreadyImported ? (
                    <Link
                      href={`/profile/${username}/detections`}
                      className={buttonClasses("primary")}
                    >
                      Review your detections
                    </Link>
                  ) : (
                    <Button
                      variant="primary"
                      onClick={() => {
                        setResult(null);
                        setPhase("strip");
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
            )}
          </div>
        )}
      </form>
    </div>
  );
}
