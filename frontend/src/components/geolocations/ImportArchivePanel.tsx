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

import { PRIMARY_BUTTON } from "@/components/ui/styles";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { FileManager } from "@/components/ui/FileManager";
import { useMutation } from "@/hooks/useMutation";
import { useDetectionsCount } from "@/contexts/DetectionsContext";
import { ApiError } from "@/lib/api";
import { stripArchive } from "@/lib/archive";
import { importArchive } from "@/lib/geolocations";
import type { ArchiveImportResult } from "@/types";

/** X's official walkthrough for requesting the data archive. */
const X_ARCHIVE_HELP =
  "https://help.x.com/en/managing-your-account/how-to-download-your-x-archive";

const BUTTON_SHAPE = "px-5 py-2.5 rounded-md text-sm font-medium disabled:opacity-50";

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

/** Map the backend's typed archive errors to a human message; fall back to the
 *  generic `errorMessage` for anything else. */
function importErrorMessage(err: unknown): string | undefined {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "archive_too_large":
        return "That archive is over the size limit. Very large archives aren't supported yet.";
      case "archive_no_tweets":
        return "That zip isn't an X data export (no tweets.js inside).";
      case "archive_malformed":
        return "That file isn't a valid .zip archive.";
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
  const [result, setResult] = useState<ArchiveImportResult | null>(null);

  // Strip to the allowlisted entries in the browser first, then upload, so the
  // sensitive rest of the export never leaves the device (and the upload is a
  // fraction of the size).
  const { run, loading, error } = useMutation(
    async (archive: File) => importArchive(await stripArchive(archive)),
    {
      onSuccess: (res) => {
        refreshDetectionCount();
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
              className={`${BUTTON_SHAPE} ${PRIMARY_BUTTON}`}
            >
              Review detections
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => {
                setResult(null);
                if (failedSome) {
                  if (file) run(file);
                } else {
                  setFile(null);
                }
              }}
              className={`${BUTTON_SHAPE} ${PRIMARY_BUTTON}`}
            >
              {failedSome ? "Try again" : "Choose a different file"}
            </button>
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
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-500/15 text-xs font-semibold text-orange-400">
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
            className="inline-flex items-center gap-1 text-orange-400 hover:underline"
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

        <button
          type="submit"
          disabled={!file || loading}
          className={`w-full sm:w-auto ${BUTTON_SHAPE} ${PRIMARY_BUTTON}`}
        >
          {loading ? "Importing…" : "Import archive"}
        </button>
        {loading && (
          <p className="text-xs text-neutral-500">
            Keeping only your posts, then uploading and detecting geolocations. A large
            archive can take a moment.
          </p>
        )}
      </form>
    </div>
  );
}
