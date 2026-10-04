"use client";

import { useState } from "react";
import Link from "next/link";
import { ExternalLink, FileArchive, ShieldCheck, Upload } from "lucide-react";

import { Button, buttonClasses } from "@/components/ui/Button";
import { TEXT_LINK } from "@/components/ui/styles";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { FileManager } from "@/components/ui/FileManager";
import {
  NumberedSteps,
  type NumberedStep,
} from "@/components/ui/NumberedSteps";
import { ProgressSteps } from "@/components/ui/ProgressSteps";
import { useMutation } from "@/hooks/useMutation";
import { useDetectionsCount } from "@/contexts/DetectionsContext";
import { ApiError } from "@/lib/api";
import { MAX_UPLOAD_LABEL, stripArchive } from "@/lib/archive";
import { ARCHIVE_EXPORT_STEPS, X_ARCHIVE_HELP } from "@/lib/archiveExport";
import {
  ImportPollLost,
  awaitImportJob,
  enqueueArchiveImport,
  presignArchiveUpload,
  uploadArchive,
} from "@/lib/events";
import type { ArchiveImportJob } from "@/types";

/** Bytes below 1 KB, then KB, then MB with one decimal below 100 MB. */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  const mb = n / (1024 * 1024);
  return `${mb.toLocaleString(undefined, {
    maximumFractionDigits: mb < 100 ? 1 : 0,
  })} MB`;
}

/** The finished run in one line; only non-zero counts appear. */
function importSummary(job: ArchiveImportJob): string {
  const parts: string[] = [];
  if (job.created > 0) {
    parts.push(
      `${job.created.toLocaleString()} detection${job.created === 1 ? "" : "s"} ready for review`
    );
  }
  if (job.updated > 0) {
    parts.push(
      `${job.updated.toLocaleString()} detection${job.updated === 1 ? "" : "s"} updated`
    );
  }
  if (job.skipped > 0) {
    parts.push(`${job.skipped.toLocaleString()} left unchanged`);
  }
  return parts.join(" · ");
}

const STEPS: NumberedStep[] = [
  ...ARCHIVE_EXPORT_STEPS,
  {
    icon: Upload,
    title: "Upload it here",
    body: "Drop the zip below. We map the geolocations in your posts for you to review.",
  },
];

/** Maps the typed errors to a human message. A transit upload failure needs no
 *  case: `ArchiveUploadError` carries its own message. */
function importErrorMessage(err: unknown): string | undefined {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "archive_too_large":
        return `That archive is over the ${MAX_UPLOAD_LABEL} safety limit, even after stripping. Get in touch and we'll find a way to import it.`;
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

/** Indexes `IMPORT_STEP_LABELS`. `strip` and `upload` are client legs, `queued`
 *  and `scanning` follow the polled job, `done` is the terminal in-place state. */
type ImportPhase = "strip" | "upload" | "queued" | "scanning" | "done";

const IMPORT_STEP_LABELS = [
  "Filtering out private data",
  "Uploading your archive",
  "Queued for import",
  "Extracting geolocations",
  "Done",
];

const IMPORT_PHASE_INDEX: Record<ImportPhase, number> = {
  strip: 0,
  upload: 1,
  queued: 2,
  scanning: 3,
  done: IMPORT_STEP_LABELS.length,
};

/**
 * The bulk-import on-ramp: the export guide, the drop zone, the in-browser
 * strip, the upload, and the bridge to the owner Detections queue. Rendered as
 * the `/submit` archive sub-mode and the onboarding entry. `username` is the
 * caller. Auth and page chrome are the parent's job.
 */
export function ImportArchivePanel({ username }: { username: string }) {
  const { refresh: refreshDetectionCount } = useDetectionsCount();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ArchiveImportJob | null>(null);
  // The poll lost the job but the import still runs server-side: render a calm
  // "check your email" state, not the failure banner.
  const [pollLost, setPollLost] = useState(false);
  const [liveJob, setLiveJob] = useState<ArchiveImportJob | null>(null);
  // Raw bytes, multipart envelope included; null outside the upload leg.
  const [uploadBytes, setUploadBytes] = useState<{ loaded: number; total: number } | null>(null);
  // Kept after a failure so the error lands on the step that raised it.
  const [phase, setPhase] = useState<ImportPhase>("strip");

  // Strip to the allowlisted entries in the browser so the rest of the export
  // never leaves the device. Then: presign, POST the zip straight to storage,
  // enqueue by key (202). The worker emails the outcome; the poll keeps this
  // page live.
  const { run, loading, error } = useMutation(
    async (archive: File): Promise<ArchiveImportJob | null> => {
      setLiveJob(null);
      setUploadBytes(null);
      setPhase("strip");
      const stripped = await stripArchive(archive);
      setPhase("upload");
      // The stripped size, refined by the first XHR progress event.
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
        // The worker picked the job up.
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
        // The completed stepper stays as the receipt; the CTA below bridges to
        // the review queue.
        setPhase("done");
        setLiveJob(job);
      }
      if (job.status === "failed") {
        // A failed job keeps what landed; re-uploading skips it and continues.
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
        // Work landed: stay on the page. Only a run that wrote nothing sets
        // `result` (retry, or already up to date).
        if (res.created === 0 && res.updated === 0) setResult(res);
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

  // `result` (write-nothing outcomes) renders under the completed stepper.
  const failedSome = (result?.failed ?? 0) > 0;
  const alreadyImported = result !== null && !failedSome && result.skipped > 0;

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-neutral-200">How to export from X</h2>
        <NumberedSteps steps={STEPS} variant="boxed" />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="inline-flex items-center gap-1.5 text-neutral-400">
            <ShieldCheck size={14} strokeWidth={1.8} className="text-neutral-500" />
            Even if you skip the trim, your browser keeps only your posts and their media before uploading; DMs, email, and phone never leave your device.
          </span>
          <Link href="/import#archive" className={TEXT_LINK}>
            Import guide
          </Link>
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
                    onRemove: () => {
                      setFile(null);
                      setPhase("strip");
                      setResult(null);
                      setLiveJob(null);
                      setUploadBytes(null);
                    },
                    removeLabel: "Remove file",
                  },
                ]
              : []
          }
          onAddFiles={(files) => {
            setFile(files[0] ?? null);
            setPhase("strip");
            setResult(null);
            setLiveJob(null);
            setUploadBytes(null);
          }}
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
                        detail: `${formatBytes(uploadBytes.loaded)} of ${formatBytes(uploadBytes.total)}`,
                      }
                    : {}),
                },
                {
                  label: IMPORT_STEP_LABELS[2],
                  spinner: true,
                  ...(liveJob?.post_estimate != null
                    ? {
                        detail: `~${liveJob.post_estimate.toLocaleString()} post${
                          liveJob.post_estimate === 1 ? "" : "s"
                        } in your archive.`,
                      }
                    : {}),
                },
                {
                  label: IMPORT_STEP_LABELS[3],
                  // Two worker legs: the parse (`progress_total` still null),
                  // then the per-detection persist. A zero total is complete.
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
                  // A run that wrote nothing leaves the receipt to the outcome
                  // message below.
                  ...(phase === "done" &&
                  liveJob &&
                  (liveJob.created > 0 || liveJob.updated > 0)
                    ? { detail: importSummary(liveJob) }
                    : {}),
                },
              ].map((step, i) =>
                // Under a failure the raising step drops its in-flight detail.
                !loading && error !== null && i === IMPORT_PHASE_INDEX[phase]
                  ? { ...step, detail: undefined, spinner: false }
                  : step
              )}
              active={IMPORT_PHASE_INDEX[phase]}
              failed={!loading && error !== null}
            />
            {/* Only once enqueued: closing during strip or upload aborts. */}
            {loading && (phase === "queued" || phase === "scanning") && (
              <p className="text-xs text-neutral-500">
                You can close this page, we email you when it&apos;s done.
              </p>
            )}
            {/* Next step, in place (no auto-redirect): retry after partial
                failures, the queue if already imported, another file if
                nothing was geolocatable. */}
            {!loading && phase === "done" && (
              <div className="space-y-3 pt-1">
                {result && (
                  <p className="text-sm text-neutral-200">
                    {failedSome
                      ? `Some posts couldn't be imported (${result.failed} failed). Try the import again.`
                      : alreadyImported
                        ? `Everything in that archive is already up to date (${result.skipped} ${
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
