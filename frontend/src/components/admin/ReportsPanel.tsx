"use client";

import { useState } from "react";
import Link from "next/link";

import {
  reportsPath,
  resolveReport,
  type ContentReportList,
  type ContentReportResolution,
} from "@/lib/admin";
import type { ContentReport } from "@/lib/events";
import { formatInstant } from "@/lib/format";
import { useApiResource } from "@/hooks/useApiResource";
import { useConfirmAction } from "@/hooks/useConfirmAction";
import { useMutation } from "@/hooks/useMutation";
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
 * Each open row carries the three verdicts. `hidden` withholds the event from
 * every public read, so it takes the two-click confirm the delete panel uses;
 * the other two are recoverable through the moderation panel beside this one.
 *
 * A report whose event was hard-deleted since carries a null `event_id`: the
 * row survives the deletion, so the row says the event is gone instead of
 * linking to it, and offers Dismiss alone. The other two verdicts would mutate
 * an event that no longer exists, and the API answers them with 409
 * `report_event_gone`.
 */

const PER_PAGE = 20;

// Human labels for the two generated vocabularies. Keyed by the union, so a new
// backend value fails `tsc` here instead of rendering as a raw enum string.
const REASON_LABELS: Record<ContentReport["reason"], string> = {
  illegal_content: "Illegal content",
  graphic_not_flagged: "Graphic, not flagged",
  copyright: "Copyright",
  privacy: "Privacy",
  other: "Something else",
};

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
  // Hard-deleted since it was reported: nothing left to mark or hide.
  const eventGone = report.event_id === null;

  return (
    <li className="border border-neutral-800 rounded-md p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Pill tone={open ? "accent" : "neutral"}>
          {open ? "Open" : (report.resolution && RESOLUTION_LABELS[report.resolution])}
        </Pill>
        <span className="text-neutral-300 font-medium">
          {REASON_LABELS[report.reason]}
        </span>
        <span className="text-neutral-500">{formatInstant(report.created_at)}</span>
        <span className="text-neutral-500">
          {report.reporter_user_id ? "signed in" : "anonymous"}
        </span>
        {eventGone ? (
          <span className="text-neutral-500">Event deleted</span>
        ) : (
          <Link href={`/events/${report.event_id}`} className={TEXT_LINK}>
            Open the event
          </Link>
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
          {!eventGone && (
            <>
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
              <Button
                variant="danger"
                disabled={busy}
                className={confirmHide.armed ? DANGER_CONFIRM : ""}
                onClick={() => confirmHide.trigger()}
              >
                {confirmHide.armed ? "Confirm" : "Hide the event"}
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
              Hiding drops the event from every public read until it is
              restored.
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
          Anyone can report an event, signed in or not. Open reports come first.
          A report is resolved once: mark the event graphic, hide it from every
          public read, or dismiss the report. Nothing here is deleted, so the
          queue records what was reported and what was decided.
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
