"use client";

import { useState } from "react";
import Link from "next/link";
import { Upload } from "lucide-react";

import { PageCenter, PageShell } from "@/components/ui/PageShell";
import { PRIMARY_BUTTON } from "@/components/ui/styles";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { useMutation } from "@/hooks/useMutation";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { useDetectionsCount } from "@/contexts/DetectionsContext";
import { ApiError } from "@/lib/api";
import { importArchive } from "@/lib/geolocations";
import type { ArchiveImportResult } from "@/types";

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

  const { run, loading, error } = useMutation(importArchive, {
    onSuccess: (res) => {
      setResult(res);
      refreshDetectionCount();
    },
    onError: importErrorMessage,
  });

  if (authLoading || !user) {
    return (
      <PageCenter>
        <span className="text-neutral-500">Loading…</span>
      </PageCenter>
    );
  }

  if (result) {
    return (
      <PageShell back title="Import your work">
        <div className="space-y-4">
          <p className="text-sm text-neutral-200">
            Imported <strong>{result.created}</strong>{" "}
            {result.created === 1 ? "detection" : "detections"} from your archive.
            {result.skipped > 0 && ` ${result.skipped} already existed.`}
          </p>
          <p className="text-xs text-neutral-500">
            Each lands as a machine-detected geolocation. Review, complete, and
            submit them from your Detections queue.
          </p>
          <div className="flex gap-3">
            <Link
              href={`/profile/${user.username}/detections`}
              className={PRIMARY_BUTTON}
            >
              Review detections
            </Link>
            <button
              type="button"
              onClick={() => {
                setResult(null);
                setFile(null);
              }}
              className="px-4 py-2 rounded-md border border-neutral-700 text-sm text-neutral-300 hover:bg-neutral-800 transition-colors"
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
      subtitle="Upload your official X archive to backfill your geolocations. We read only your posts (tweets.js and their media); nothing else in the export is opened."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (file) run(file);
        }}
        className="space-y-4"
        noValidate
      >
        <label className="flex flex-col items-center justify-center gap-2 px-4 py-10 rounded-lg border border-dashed border-neutral-700 cursor-pointer hover:border-orange-500/40 transition-colors text-center">
          <Upload size={22} strokeWidth={1.8} className="text-neutral-500" />
          <span className="text-sm text-neutral-300">
            {file ? file.name : "Choose your X archive (.zip)"}
          </span>
          <span className="text-xs text-neutral-600">
            From X: Settings → Your account → Download an archive of your data.
          </span>
          <input
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>

        {error && <div className={FORM_ERROR_BANNER}>{error}</div>}

        <button type="submit" disabled={!file || loading} className={PRIMARY_BUTTON}>
          {loading ? "Importing…" : "Import"}
        </button>
        {loading && (
          <p className="text-xs text-neutral-500">
            Reading your archive and detecting geolocations. A large archive can
            take a moment.
          </p>
        )}
      </form>
    </PageShell>
  );
}
