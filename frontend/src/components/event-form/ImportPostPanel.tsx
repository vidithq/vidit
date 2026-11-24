"use client";

import { useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { ActionIcon, Button, buttonClasses, type ButtonAction } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { FieldHelp } from "@/components/ui/FieldHelp";
import { FORM_SUCCESS_BANNER } from "@/components/ui/form-styles";
import { TEXT_LINK, WARNING_CALLOUT } from "@/components/ui/styles";
import { useDetectionsCount } from "@/contexts/DetectionsContext";
import { useApiResource } from "@/hooks/useApiResource";
import { useMutation } from "@/hooks/useMutation";
import { importFromPost } from "@/lib/events";
import { eventEditHref, eventHref, requestHref } from "@/lib/routes";
import type { EventDetail, TweetImportOutcome } from "@/types";
import { countLabel } from "@/lib/format";
import { ErrorNotice } from "@/components/ui/ErrorNotice";

/** How an import entry fills its page: the submit button for the actions, the entry for the body. */
export type ImportShell = (slots: { actions: ReactNode; body: ReactNode }) => ReactNode;

function outcomeSummary(outcome: TweetImportOutcome): string {
  if (outcome.created.length === 0 && outcome.updated.length === 0 && outcome.skipped.length > 0) {
    return "Already imported";
  }
  const parts: string[] = [];
  if (outcome.created.length > 0) {
    parts.push(`${countLabel(outcome.created.length, "detection")} created`);
  }
  if (outcome.updated.length > 0) {
    parts.push(`${outcome.updated.length} updated`);
  }
  if (outcome.skipped.length > 0) {
    parts.push(`${outcome.skipped.length} already imported`);
  }
  return parts.join(" · ");
}

/** The first detection created, else the first the re-import overwrote. */
function firstDetectionId(outcome: TweetImportOutcome): string | undefined {
  return [...outcome.created, ...outcome.updated][0];
}

/** The row an already-imported post points at, opened where its state reads: a detection's
 *  review, a request's page, or the event page once published or closed. */
function existingRowLink(row: Pick<EventDetail, "id" | "status">): {
  href: string;
  label: string;
  action: ButtonAction;
} {
  if (row.status === "detected") {
    return { href: eventEditHref(row.id, true), label: "Review the detection", action: "review" };
  }
  if (row.status === "requested") {
    return { href: requestHref(row.id), label: "Open the request", action: "show" };
  }
  return { href: eventHref(row.id), label: "Open the event", action: "show" };
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
 * refusal, or a post already imported stays here and says so, with the
 * detection, request or event one click away when there is one to open.
 *
 * Warning and refusal sentences come with their code from the backend table the
 * bot's reply and the archive email also read, so this page holds no copy.
 *
 * `shell` lays the page out: **Create the detection** for the page's actions,
 * the form for its body.
 */
export function ImportPostPanel({ shell }: { shell: ImportShell }) {
  const formId = useId();
  const router = useRouter();
  const { refresh: refreshDetectionCount } = useDetectionsCount();
  const [url, setUrl] = useState("");
  const [outcome, setOutcome] = useState<TweetImportOutcome | null>(null);

  const { run, loading, error } = useMutation(importFromPost, {
    onSuccess: (result) => {
      refreshDetectionCount();
      const detectionId = firstDetectionId(result);
      if (detectionId !== undefined && result.warnings.length === 0 && result.created.length > 0) {
        router.push(eventEditHref(detectionId, true));
        return;
      }
      setOutcome(result);
    },
  });

  const detectionId = outcome === null ? undefined : firstDetectionId(outcome);
  // A post already imported wrote no row, so its link waits on the existing row's state; a row
  // that no longer opens answers an error and the line stands alone.
  const existingId = detectionId === undefined ? outcome?.skipped[0] : undefined;
  const { data: existing } = useApiResource<EventDetail>(
    existingId === undefined ? null : `/events/${encodeURIComponent(existingId)}`
  );
  const next =
    detectionId !== undefined
      ? existingRowLink({ id: detectionId, status: "detected" })
      : existing !== null && existing.id === existingId
        ? existingRowLink(existing)
        : null;
  const warnings = outcome?.warnings ?? [];

  const body = (
    <form
      id={formId}
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
        <Input
          type="url"
          aria-label="X post URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://x.com/handle/status/…"
          disabled={loading}
        />
      </div>

      {error && <ErrorNotice error={error} />}

      {outcome && (
        <div className="space-y-3">
          {/* A refusal or an unstorable post is a failure: a success banner
              would tell the analyst the paste worked. */}
          {wroteSomething(outcome) ? (
            <div className={FORM_SUCCESS_BANNER}>{outcomeLine(outcome)}</div>
          ) : (
            <ErrorNotice error={outcomeLine(outcome)} />
          )}
          {warnings.length > 0 && (
            <ul className={`space-y-1 rounded-md p-3 text-xs ${WARNING_CALLOUT}`}>
              {warnings.map((warning) => (
                <li key={warning.code}>{warning.message}</li>
              ))}
            </ul>
          )}
          {next !== null && (
            <Link href={next.href} className={buttonClasses("primary")}>
              <ActionIcon action={next.action} />
              {next.label}
            </Link>
          )}
        </div>
      )}
    </form>
  );

  // In the page's actions, outside the form: `form` ties it back, and Enter in the field still
  // submits.
  const actions = (
    <Button
      action="import"
      type="submit"
      form={formId}
      variant="primary"
      disabled={loading || !url.trim()}
      className="whitespace-nowrap"
    >
      {loading ? "Reading…" : "Create the detection"}
    </Button>
  );

  return shell({ actions, body });
}
