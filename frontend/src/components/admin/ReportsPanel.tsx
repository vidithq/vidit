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
import { siteHref } from "@/lib/sites";
import { REPORT_REASON_LABELS, type ContentReport } from "@/lib/events";
import { formatInstant } from "@/lib/format";
import { useCursorList } from "@/hooks/useCursorList";
import { useMutation } from "@/hooks/useMutation";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { LoadMoreRow } from "@/components/ui/LoadMoreRow";
import { Pill } from "@/components/ui/Pill";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { LIST_TILE } from "@/components/ui/form-styles";
import { TEXT_LINK } from "@/components/ui/styles";
import { eventHref } from "@/lib/routes";
import { ErrorNotice } from "@/components/ui/ErrorNotice";

/**
 * The moderation queue: every content report, open first and newest first within each group (the
 * API owns the order). Resolved rows stay, so the queue doubles as the record of what was reported
 * and decided.
 *
 * A report names an event, a collection or a site. An event row links out by id; a collection or
 * site row prints the name and owner it came back with, since those are names, not recognisable
 * ids.
 *
 * Each open row carries the verdicts its target can take. `hidden` withholds the target from every
 * public read, so it opens a `ConfirmDialog`, as on the event actions panel. `Mark graphic` is
 * event-only (the flag is an event column): a collection or site row doesn't offer it and the API
 * answers 409 `report_verdict_not_applicable`. Each is recoverable: the event through the event
 * actions panel beside this one, the collection through the admin takedown, and the site through
 * **Restore** on its page.
 *
 * A report whose target was since deleted survives the deletion: the row says the target is gone
 * instead of linking, and offers Dismiss alone (every other verdict gets 409
 * `report_target_gone`).
 *
 * A collection its owner deleted while a report on it was open is still here in full: the row marks
 * it "Deleted by its owner" and takes the normal verdicts. Resolving its last open report, by any
 * verdict, erases it.
 */

const PER_PAGE = 20;

// Bucket labels are the reporter-facing ones (`REPORT_REASON_LABELS`). The verdicts are this
// surface's vocabulary, keyed by the generated union so a new backend value fails `tsc` here
// instead of rendering a raw enum string.
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
  const [confirmingHide, setConfirmingHide] = useState(false);
  const resolveMutation = useMutation(
    (resolution: ContentReportResolution) => resolveReport(report.id, resolution),
    {
      fallback: "Resolve failed",
      onSuccess: () => {
        setConfirmingHide(false);
        onResolved();
      },
    }
  );

  const open = report.resolved_at === null;
  const busy = resolveMutation.loading;
  // Which kind of row this is. A report names one target, so at most one is set; neither once the target was deleted.
  const collection = report.collection;
  const site = report.site ?? null;
  const isEvent = report.event_id !== null;
  const targetGone = !isEvent && collection === null && site === null;
  const ownerDeleted = Boolean(collection?.deleted_at);
  const noun = isEvent ? "event" : site ? "site" : "collection";

  return (
    <li className={`${LIST_TILE} space-y-2`}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Pill tone={open ? "accent" : "neutral"}>
          {open ? "Open" : (report.resolution && RESOLUTION_LABELS[report.resolution])}
        </Pill>
        <span className="text-neutral-300 font-medium">
          {REPORT_REASON_LABELS[report.reason]}
        </span>
        <span className="text-neutral-500">{formatInstant(report.created_at)}</span>
        <span className="text-neutral-500">
          {report.reporter_id ? "signed in" : "anonymous"}
        </span>
        {report.event_id !== null && (
          <Link href={eventHref(report.event_id)} className={TEXT_LINK}>
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
        {site && (
          <>
            <Link href={siteHref(site.id)} className={TEXT_LINK}>
              {site.name}
            </Link>
            <AuthorByline author={site.owner} size="xs" />
          </>
        )}
        {ownerDeleted && (
          <Pill title="Erased once no open report names it">Deleted by its owner</Pill>
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

      {resolveMutation.error && !confirmingHide && (
        <ErrorNotice error={resolveMutation.error} />
      )}

      {open && (
        <div className="flex flex-wrap items-center gap-2">
          {report.event_id !== null && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void resolveMutation.run("marked_graphic")}
            >
              Mark graphic
            </Button>
          )}
          {!targetGone && (
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => {
                resolveMutation.reset();
                setConfirmingHide(true);
              }}
            >
              Hide the {noun}
            </Button>
          )}
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void resolveMutation.run("dismissed")}
          >
            Dismiss
          </Button>
        </div>
      )}

      {confirmingHide && (
        <ConfirmDialog
          title={`Hide the ${noun}?`}
          confirmLabel={`Hide the ${noun}`}
          busyLabel="Hiding…"
          busy={busy}
          error={resolveMutation.error}
          tone={ownerDeleted ? "danger" : "accent"}
          onConfirm={() => void resolveMutation.run("hidden")}
          onCancel={() => {
            setConfirmingHide(false);
            resolveMutation.reset();
          }}
        >
          <p>
            {ownerDeleted
              ? "Its owner deleted it, so resolving the last open report on it erases it."
              : `Hiding drops the ${noun} from every public read until it is restored, and resolves the report as Hidden.`}
          </p>
        </ConfirmDialog>
      )}
    </li>
  );
}

// `/admin/reports` is offset-paged, so the walk's cursor is the next page number.
const reportsPage = (cursor: string | null) =>
  reportsPath(cursor === null ? 1 : Number(cursor), PER_PAGE);
const reportRows = (list: ContentReportList) => list.items;
const nextReportsPage = ({ items: list }: { items: ContentReportList }) =>
  list.page * list.per_page < list.total ? String(list.page + 1) : null;

export function ReportsPanel() {
  const walk = useCursorList<ContentReport, ContentReportList>(
    reportsPage,
    reportRows,
    nextReportsPage
  );
  const { items: reports, loading, reload } = walk;
  // A failed later page shows in the load-more row; only a failed first page leaves no rows.
  const error = reports.length === 0 ? walk.error : null;

  return (
    <Card as="section">
      <header>
        <SectionEyebrow title="Content reports" margin="none" />
        <p className="text-xs text-neutral-500 mt-0.5">
          Anyone can report an event, a collection or a site, signed in or not. Open
          reports come first. A report is resolved once: mark the event graphic,
          hide the reported item from every public read, or dismiss the report.
          Nothing here is deleted, so the queue records what was reported and
          what was decided.
        </p>
      </header>

      {error && <ErrorNotice error={error} />}
      {loading && <div className="text-xs text-neutral-500 py-2">Loading…</div>}

      {!loading && !error && reports.length === 0 && (
        <p className="text-xs text-neutral-500 py-2">No reports yet.</p>
      )}

      {reports.length > 0 && (
        <ul className="space-y-2">
          {reports.map((report) => (
            // A verdict moves its row out of the open group and shifts every offset after it, so
            // the walk restarts.
            <ReportRow key={report.id} report={report} onResolved={reload} />
          ))}
        </ul>
      )}

      <LoadMoreRow walk={walk} />
    </Card>
  );
}
