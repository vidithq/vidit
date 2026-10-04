"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button, buttonClasses } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { FieldHelp } from "@/components/ui/FieldHelp";
import { FORM_ERROR_BANNER, FORM_SUCCESS_BANNER } from "@/components/ui/form-styles";
import { TEXT_LINK, WARNING_CALLOUT } from "@/components/ui/styles";
import { useDetectionsCount } from "@/contexts/DetectionsContext";
import { useMutation } from "@/hooks/useMutation";
import { detectionEditPath, importFromPost } from "@/lib/events";
import type { TweetImportOutcome } from "@/types";

function outcomeSummary(outcome: TweetImportOutcome): string {
  const parts: string[] = [];
  if (outcome.created.length > 0) {
    parts.push(`${outcome.created.length} detection${outcome.created.length === 1 ? "" : "s"} created`);
  }
  if (outcome.updated.length > 0) {
    parts.push(`${outcome.updated.length} updated`);
  }
  if (outcome.skipped.length > 0) {
    parts.push(
      `${outcome.skipped.length} left as ${outcome.skipped.length === 1 ? "it is" : "they are"}`
    );
  }
  return parts.join(" · ");
}

/** The first detection created, else the first the re-import overwrote. Never a
 *  skipped row: those are not the import's to edit (published, closed or
 *  withheld), so a review link would offer an edit that cannot land. */
function firstDetectionId(outcome: TweetImportOutcome): string | undefined {
  return [...outcome.created, ...outcome.updated][0];
}

/** False is the failure shape: a refusal, or a post nothing could be stored from. */
function wroteSomething(outcome: TweetImportOutcome): boolean {
  return (
    outcome.created.length > 0 || outcome.updated.length > 0 || outcome.skipped.length > 0
  );
}

function outcomeLine(outcome: TweetImportOutcome): string {
  const summary = outcomeSummary(outcome);
  if (summary) return summary;
  if (outcome.failed > 0) {
    return "That post couldn't be stored. Try again in a minute.";
  }
  return outcome.reason?.message ?? "That post produced no detection. Fill the form yourself instead.";
}

/**
 * The "From an X post" entry: paste a link to one of your own posts and the
 * detection engine reads it into detections, like the bot and the archive
 * backfill. The API answers `not_your_post` when the author differs from your
 * linked X account; that message renders as-is.
 *
 * A clean run goes straight to the detection's review. A run with warnings, a
 * refusal, or a post left as it is stays here and says so, with the review one
 * click away when there is a detection to open.
 *
 * Warning and refusal sentences come with their code from the backend table the
 * bot's reply and the archive email also read, so this page holds no copy.
 */
export function ImportPostPanel() {
  const router = useRouter();
  const { refresh: refreshDetectionCount } = useDetectionsCount();
  const [url, setUrl] = useState("");
  const [outcome, setOutcome] = useState<TweetImportOutcome | null>(null);

  const { run, loading, error } = useMutation(importFromPost, {
    onSuccess: (result) => {
      refreshDetectionCount();
      const detectionId = firstDetectionId(result);
      if (detectionId !== undefined && result.warnings.length === 0 && result.created.length > 0) {
        router.push(detectionEditPath(detectionId, true));
        return;
      }
      setOutcome(result);
    },
  });

  const detectionId = outcome === null ? undefined : firstDetectionId(outcome);
  const warnings = outcome?.warnings ?? [];

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setOutcome(null);
        if (url.trim()) run(url.trim());
      }}
      className="space-y-4"
      noValidate
    >
      <div className="space-y-1.5">
        <p className="text-sm text-neutral-200">
          Paste one of your own X posts. Its coordinates, source and media become a detection
          you review. <FieldHelp concept="section_import" />{" "}
          <Link href="/import#paste" className={TEXT_LINK}>
            Import guide
          </Link>
        </p>
        {/* Stacks below `sm`: at 320px the one-line button leaves the field
            about 100px. */}
        <div className="flex max-sm:flex-col gap-2">
          <Input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://x.com/handle/status/…"
            disabled={loading}
          />
          <Button
            type="submit"
            variant="primary"
            disabled={loading || !url.trim()}
            className="whitespace-nowrap"
          >
            {loading ? "Reading…" : "Create the detection"}
          </Button>
        </div>
      </div>

      {error && <div className={FORM_ERROR_BANNER}>{error}</div>}

      {outcome && (
        <div className="space-y-3">
          {/* A refusal or an unstorable post is a failure: a success banner
              would tell the analyst the paste worked. */}
          <div className={wroteSomething(outcome) ? FORM_SUCCESS_BANNER : FORM_ERROR_BANNER}>
            {outcomeLine(outcome)}
          </div>
          {warnings.length > 0 && (
            <ul className={`space-y-1 rounded-md p-3 text-xs ${WARNING_CALLOUT}`}>
              {warnings.map((warning) => (
                <li key={warning.code}>{warning.message}</li>
              ))}
            </ul>
          )}
          {detectionId !== undefined && (
            <Link href={detectionEditPath(detectionId, true)} className={buttonClasses("primary")}>
              Review the detection
            </Link>
          )}
        </div>
      )}
    </form>
  );
}
