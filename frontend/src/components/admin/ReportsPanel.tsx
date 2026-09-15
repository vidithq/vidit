"use client";

import { useState } from "react";
import Link from "next/link";

import {
  reportsPath,
  resolveReport,
  type ContentReportList,
  type ContentReportResolution,
} from "@/lib/admin";
import { collectionHref } from "@/lib/collections";
import { REPORT_REASON_LABELS, type ContentReport } from "@/lib/events";
import { formatInstant } from "@/lib/format";
import { useApiResource } from "@/hooks/useApiResource";
import { useConfirmAction } from "@/hooks/useConfirmAction";
import { useMutation } from "@/hooks/useMutation";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { Button, DANGER_CONFIRM } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { TEXT_LINK } from "@/components/ui/styles";

/**
 * The moderation queue: every content report, open ones first and newest first
 * within each group (the API owns that order). Resolved rows stay in the list
 * rather than dropping out of it, so the queue doubles as the record of what
 * was reported and what was decided.
 *
 * A report names an event or a collection, and one list answers for both. An
 * event row links out by id, the way every other admin surface reaches one; a
 * collection row prints the title and the owner it came back with, because a
 * collection is a name rather than a page an admin recognises from its id.
 *
 * Each open row carries the verdicts its target can take. `hidden` withholds
 * the target from every public read, event or collection, so it takes the
 * two-click confirm the delete panel uses. `Mark graphic` is an event verdict
 * only: the flag is a column on the event, and a collection carries no footage
 * of its own, so a collection row does not offer it and the API answers it
 * with 409 `report_verdict_not_applicable`. Both are recoverable, the event
 * through the moderation panel beside this one and the collection through the
 * admin takedown.
 *
 * A report whose target was deleted since carries neither: the row survives
 * the deletion, so it says the target is gone instead of linking to it, and
 * offers Dismiss alone. Every other verdict would mutate a row that no longer
 * exists, and the API answers them with 409 `report_target_gone`.
 */

const PER_PAGE = 20;

// The bucket labels are the reporter-facing ones (`REPORT_REASON_LABELS`), so
// the queue reads a report back in the words the reporter picked it by. The
// verdicts are this surface's own vocabulary: keyed by the generated union, so
// a new backend value fails `tsc` here instead of rendering as a raw enum
// string.
const RESOLUTION_LABELS: Record<ContentReportResolution, string> = {
  marked_graphic: "Marked graphic",
  hidden: "Hidden",
  dismissed: "Dismissed",
};

function ReportRow({
  report,
  onResolved,
}: {
  report: ContentReport;
  onResolved: () => void;
}) {
  const resolveMutation = useMutation(
    (resolution: ContentReportResolution) => resolveReport(report.id, resolution),
    { fallback: "Resolve failed", onSuccess: onResolved }
  );
  const confirmHide = useConfirmAction(() => {
    void resolveMutation.run("hidden");
  });

  const open = report.resolved_at === null;
  const busy = resolveMutation.loading;
  // Which kind of row this is. A report names one target, so at most one of
  // the two is set; neither is set once that target was deleted, and then
  // there is nothing left to mark or hide.
  const collection = report.collection;
  const isEvent = report.event_id !== null;
  const targetGone = !isEvent && collection === null;

  return (
    <li className="border border-neutral-800 rounded-md p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Pill tone={open ? "accent" : "neutral"}>
          {open ? "Open" : (report.resolution && RESOLUTION_LABELS[report.resolution])}
        </Pill>
        <span className="text-neutral-300 font-medium">
          {REPORT_REASON_LABELS[report.reason]}
        </span>
        <span className="text-neutral-500">{formatInstant(report.created_at)}</span>
        <span className="text-neutral-500">
          {report.reporter_user_id ? "signed in" : "anonymous"}
        </span>
        {isEvent && (
          <Link href={`/events/${report.event_id}`} className={TEXT_LINK}>
            Open the event
          </Link>
        )}
        {collection && (
          <>
            <Link href={collectionHref(collection.id)} className={TEXT_LINK}>
              {collection.title}
            </Link>
            <AuthorByline author={collection.owner} size="xs" />
          </>
        )}
        {targetGone && (
          <span className="text-neutral-500">Reported item deleted</span>
        )}
      </div>

      {report.details && (
        <p className="text-xs text-neutral-400 whitespace-pre-wrap [overflow-wrap:anywhere]">
          {report.details}
        </p>
      )}

      {resolveMutation.error && (
        <div className={FORM_ERROR_BANNER} role="alert">
          {resolveMutation.error}
        </div>
      )}

      {open && (
        <div className="flex flex-wrap items-center gap-2">
          {isEvent && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                confirmHide.cancel();
                void resolveMutation.run("marked_graphic");
              }}
            >
              Mark graphic
            </Button>
          )}
          {!targetGone && (
            <>
              <Button
                variant="danger"
                disabled={busy}
                className={confirmHide.armed ? DANGER_CONFIRM : ""}
                onClick={() => confirmHide.trigger()}
              >
                {confirmHide.armed
                  ? "Confirm"
                  : `Hide the ${isEvent ? "event" : "collection"}`}
              </Button>
              {confirmHide.armed && (
                <Button variant="ghost" onClick={() => confirmHide.cancel()}>
                  Cancel
                </Button>
              )}
            </>
          )}
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              confirmHide.cancel();
              void resolveMutation.run("dismissed");
            }}
          >
            Dismiss
          </Button>
          {confirmHide.armed && (
            <span className="text-xs text-amber-400/90">
              Hiding drops the {isEvent ? "event" : "collection"} from every
              public read until it is restored.
            </span>
          )}
        </div>
      )}
    </li>
  );
}

export function ReportsPanel() {
  const [page, setPage] = useState(1);
  const { data, error, loading, refetch } = useApiResource<ContentReportList>(
    reportsPath(page, PER_PAGE)
  );

  const reports = data?.items ?? [];
  const total = data?.total ?? 0;
  const hasMore = page * PER_PAGE < total;

  return (
    <Card as="section">
      <header>
        <SectionEyebrow title="Content reports" margin="none" />
        <p className="text-xs text-neutral-500 mt-0.5">
          Anyone can report an event or a collection, signed in or not. Open
          reports come first. A report is resolved once: mark the event graphic,
          hide the reported item from every public read, or dismiss the report.
          Nothing here is deleted, so the queue records what was reported and
          what was decided.
        </p>
      </header>

      {error && <div className={FORM_ERROR_BANNER}>{error}</div>}
      {loading && !error && (
        <div className="text-xs text-neutral-500 py-2">Loading…</div>
      )}

      {!loading && !error && reports.length === 0 && (
        <p className="text-xs text-neutral-500 py-2">No reports yet.</p>
      )}

      {reports.length > 0 && (
        <ul className="space-y-2">
          {reports.map((report) => (
            <ReportRow key={report.id} report={report} onResolved={refetch} />
          ))}
        </ul>
      )}

      {(page > 1 || hasMore) && (
        <div className="flex items-center gap-3 text-xs text-neutral-500">
          <Button
            variant="ghost"
            disabled={page === 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </Button>
          <span>
            Page {page} of {Math.max(1, Math.ceil(total / PER_PAGE))}
          </span>
          <Button
            variant="ghost"
            disabled={!hasMore}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </Card>
  );
}
