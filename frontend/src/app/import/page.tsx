"use client";

import { useState } from "react";
import Link from "next/link";
import { Clock, Download, ExternalLink, Scissors, Settings, ShieldCheck, Upload } from "lucide-react";

import { PageCenter, PageShell } from "@/components/ui/PageShell";
import { PRIMARY_BUTTON } from "@/components/ui/styles";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { useMutation } from "@/hooks/useMutation";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { useDetectionsCount } from "@/contexts/DetectionsContext";
import { ApiError } from "@/lib/api";
import { stripArchive } from "@/lib/archive";
import { importArchive } from "@/lib/geolocations";
import type { ArchiveImportResult } from "@/types";

/** X's official walkthrough for requesting the data archive. */
const X_ARCHIVE_HELP =
  "https://help.x.com/en/managing-your-account/how-to-download-your-x-archive";

/** Shape for the page's action buttons (colour comes from `PRIMARY_BUTTON`). */
const BUTTON_SHAPE = "px-5 py-2.5 rounded-md text-sm font-medium disabled:opacity-50";

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

export default function ImportPage() {
  const { user, loading: authLoading } = useRequireAuth();
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
        setResult(res);
        refreshDetectionCount();
      },
      onError: importErrorMessage,
    }
  );

  if (authLoading || !user) {
    return (
      <PageCenter>
        <span className="text-neutral-500">Loading…</span>
      </PageCenter>
    );
  }

  if (result) {
    const nothing = result.created === 0 && result.skipped === 0;
    return (
      <PageShell back title="Import your work">
        <div className="space-y-4">
          <p className="text-sm text-neutral-200">
            {nothing ? (
              "No geolocations found in that archive. Posts with a coordinate in their text become detections."
            ) : (
              <>
                Imported <strong>{result.created}</strong>{" "}
                {result.created === 1 ? "geolocation" : "geolocations"}.
                {result.skipped > 0 && ` ${result.skipped} were already imported.`}
              </>
            )}
          </p>
          {result.created > 0 && (
            <p className="text-xs text-neutral-500">
              Each lands as a machine-detected geolocation. Review, complete, and submit
              them from your Detections queue.
            </p>
          )}
          <div className="flex flex-wrap gap-3 pt-1">
            {result.created > 0 && (
              <Link
                href={`/profile/${user.username}/detections`}
                className={`${BUTTON_SHAPE} ${PRIMARY_BUTTON}`}
              >
                Review detections
              </Link>
            )}
            <button
              type="button"
              onClick={() => {
                setResult(null);
                setFile(null);
              }}
              className={`${BUTTON_SHAPE} border border-neutral-700 text-neutral-300 hover:bg-neutral-800 transition-colors`}
            >
              Import another
            </button>
          </div>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      back
      title="Import your work"
      subtitle="Backfill your geolocations from your official X archive. It's the fastest way to bring your existing work onto the map."
    >
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
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-neutral-700 px-4 py-10 text-center transition-colors hover:border-orange-500/40">
            <Upload size={22} strokeWidth={1.8} className="text-neutral-500" />
            <span className="text-sm text-neutral-200">
              {file ? file.name : "Choose your X archive (.zip)"}
            </span>
            <span className="text-xs text-neutral-600">
              {file ? "Click to choose a different file" : "or drag it onto this box"}
            </span>
            <input
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>

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
    </PageShell>
  );
}
