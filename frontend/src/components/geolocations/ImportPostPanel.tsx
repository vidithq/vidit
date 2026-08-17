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
import { draftEditPath, importFromPost } from "@/lib/events";
import type { TweetImportOutcome } from "@/types";

/** The finished run in one line: what landed, what moved, what was left alone. */
function outcomeSummary(outcome: TweetImportOutcome): string {
  const parts: string[] = [];
  if (outcome.created.length > 0) {
    parts.push(`${outcome.created.length} draft${outcome.created.length === 1 ? "" : "s"} created`);
  }
  if (outcome.updated.length > 0) {
    parts.push(`${outcome.updated.length} updated`);
  }
  if (outcome.skipped.length > 0) {
    parts.push(`${outcome.skipped.length} already imported`);
  }
  return parts.join(" · ");
}

/** The draft the page opens: the first one created, else the first one the
 *  re-import touched. Undefined when the post produced nothing. */
function firstDraftId(outcome: TweetImportOutcome): string | undefined {
  return [...outcome.created, ...outcome.updated, ...outcome.skipped][0];
}

/** The one line a finished run says: what it wrote, else why it wrote nothing. */
function outcomeLine(outcome: TweetImportOutcome): string {
  const summary = outcomeSummary(outcome);
  if (summary) return summary;
  if (outcome.failed > 0) {
    return "That post couldn't be stored. Try again in a minute.";
  }
  return outcome.reason?.message ?? "That post produced no draft. Fill the form yourself instead.";
}

/**
 * The "From an X post" entry: paste a link to one of your own posts and the
 * detection engine reads it into `detected` drafts, the same drafts the bot and
 * the archive backfill create. Own posts only, so the API compares the post's
 * author against the X account linked to your profile and answers
 * `not_your_post` otherwise; that message is rendered as-is.
 *
 * A clean run goes straight to the draft's review. A run with something to say
 * (warnings, a refusal, an already-imported post) stays here and says it, with
 * the review one click away, so nothing the engine raised is lost in a redirect.
 *
 * The sentence for a warning or a refusal arrives with its code: the bot's
 * in-thread reply and the archive's outcome email read the same backend table,
 * so this page holds no copy of its own and cannot describe one code
 * differently from the other two entries.
 */
export function ImportPostPanel() {
  const router = useRouter();
  const { refresh: refreshDetectionCount } = useDetectionsCount();
  const [url, setUrl] = useState("");
  const [outcome, setOutcome] = useState<TweetImportOutcome | null>(null);

  const { run, loading, error } = useMutation(importFromPost, {
    onSuccess: (result) => {
      refreshDetectionCount();
      const draftId = firstDraftId(result);
      if (draftId !== undefined && result.warnings.length === 0 && result.created.length > 0) {
        router.push(draftEditPath(draftId, true));
        return;
      }
      setOutcome(result);
    },
  });

  const draftId = outcome === null ? undefined : firstDraftId(outcome);
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
          Paste one of your own X posts. Its coordinates, source and media become a draft
          you review. <FieldHelp concept="section_import" />{" "}
          <Link href="/import#paste" className={TEXT_LINK}>
            Import guide
          </Link>
        </p>
        <div className="flex gap-2">
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
            {loading ? "Reading…" : "Create the draft"}
          </Button>
        </div>
      </div>

      {error && <div className={FORM_ERROR_BANNER}>{error}</div>}

      {outcome && (
        <div className="space-y-3">
          <div className={FORM_SUCCESS_BANNER}>{outcomeLine(outcome)}</div>
          {warnings.length > 0 && (
            <ul className={`space-y-1 rounded-md p-3 text-xs ${WARNING_CALLOUT}`}>
              {warnings.map((warning) => (
                <li key={warning.code}>{warning.message}</li>
              ))}
            </ul>
          )}
          {draftId !== undefined && (
            <Link href={draftEditPath(draftId, true)} className={buttonClasses("primary")}>
              Review the draft
            </Link>
          )}
        </div>
      )}
    </form>
  );
}
