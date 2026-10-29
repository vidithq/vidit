"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Flag } from "lucide-react";

import { reportCollection } from "@/lib/collections";
import { reportSite } from "@/lib/sites";
import {
  REPORT_DETAILS_MAX_LEN,
  REPORT_REASON_LABELS,
  reportEvent,
  type ContentReport,
  type ContentReportReason,
} from "@/lib/events";
import { useMutation } from "@/hooks/useMutation";
import { Button } from "@/components/ui/Button";
import { CharCounter } from "@/components/ui/CharCounter";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { FieldHelp } from "@/components/ui/FieldHelp";
import { Textarea } from "@/components/ui/Input";
import { OptionSearch } from "@/components/ui/OptionSearch";
import { FORM_LABEL, FORM_SUCCESS_BANNER } from "@/components/ui/form-styles";

/**
 * The reader's "something is wrong with this" control, on every detail surface. One state machine,
 * two nodes: `trigger` is the red flag icon button closing the utilities tier next to the share
 * controls, and `panel` is the `ConfirmDialog` it opens (the reason, the details, then **Cancel**
 * and **Send report**), or the receipt once a report lands, rendered in the surface's body.
 * `useEventActions` assembles both into the event cluster, and the collection page into its own.
 *
 * Icon-only like the share pair: `aria-label` plus `title` carry the name. Red because reporting
 * is the destructive-in-intent act a reader can do to a published claim: the `danger` variant of
 * quiet destructive triggers, not the loud `DANGER_CONFIRM` fill reserved for an armed second click.
 *
 * Works signed out: those who most need to flag illegal or mislabelled footage rarely hold an
 * account, so the endpoint takes an anonymous write and `apiFetch` omits the CSRF header with no
 * session cookie.
 *
 * The bucket is the one vocabulary selector, `<OptionSearch>` in its single mode. The reporter's words are optional, since the bucket is often the whole
 * report; the details' `?` says so rather than the label.
 *
 * One hook for every reportable kind, parameterised by `kind`: the endpoints take the same
 * body under the same cap, so a second copy would be a second place for the buckets and the
 * 2000-character ceiling to drift.
 */

/** What this report is filed against. Mirrors the three report routes. */
type ReportTargetKind = "event" | "collection" | "site";

// The call per kind and the noun the copy uses, keyed by the union so a third target fails `tsc` here.
const SUBMIT: Record<
  ReportTargetKind,
  (id: string, body: { reason: ContentReportReason; details: string | null }) => Promise<ContentReport>
> = {
  event: reportEvent,
  collection: reportCollection,
  site: reportSite,
};

const NOUN: Record<ReportTargetKind, string> = {
  event: "event",
  collection: "collection",
  site: "site",
};

// The select's order, from the shared label map so the form and the admin queue name buckets alike.
const REASONS = Object.keys(REPORT_REASON_LABELS) as ContentReportReason[];

export function useReportContent(
  kind: ReportTargetKind,
  targetId: string,
): {
  trigger: ReactNode;
  panel: ReactNode;
} {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ContentReportReason>("illegal_content");
  const [details, setDetails] = useState("");
  const [sent, setSent] = useState(false);

  // The hook outlives the row it reports on (the map panel and client navigation swap `targetId`
  // under a mounted component). Reset, or an open form, typed reason, details or the "report
  // received" receipt carry to the next row, and the receipt would hide the trigger for something
  // not reported.
  useEffect(() => {
    setOpen(false);
    setReason("illegal_content");
    setDetails("");
    setSent(false);
  }, [kind, targetId]);

  const reportMutation = useMutation(
    () =>
      SUBMIT[kind](targetId, {
        reason,
        details: details.trim() || null,
      }),
    {
      fallback: "Report failed",
      onSuccess: () => {
        setSent(true);
        setOpen(false);
        setDetails("");
      },
    }
  );

  const busy = reportMutation.loading;

  // The receipt replaces both nodes for the rest of the visit: a second report of the same row adds nothing.
  if (sent) {
    return {
      trigger: null,
      panel: (
        <div className={FORM_SUCCESS_BANNER} role="status">
          Report received. An admin reviews it and decides what happens to the{" "}
          {NOUN[kind]}.
        </div>
      ),
    };
  }

  const trigger = (
    <Button
      icon
      variant="dangerGhost"
      aria-label="Report"
      title="Report"
      aria-haspopup="dialog"
      onClick={() => {
        reportMutation.reset();
        setOpen(true);
      }}
    >
      <Flag size={14} />
    </Button>
  );

  if (!open) return { trigger, panel: null };

  return {
    trigger,
    panel: (
      <ConfirmDialog
        title={`Report this ${NOUN[kind]}`}
        confirmLabel="Send report"
        confirmAction="report"
        busyLabel="Sending…"
        busy={busy}
        error={reportMutation.error}
        onConfirm={() => void reportMutation.run()}
        onCancel={() => setOpen(false)}
      >
        <p>
          No account needed. Say what is wrong with it and an admin reviews the{" "}
          {NOUN[kind]}.
        </p>

        <div className="space-y-1.5 pt-1">
          <span className="flex items-center gap-1.5">
            <label htmlFor="report_reason" className={FORM_LABEL}>
              Reason
            </label>
            <FieldHelp concept="report_reason" />
          </span>
          <OptionSearch
            single
            required
            id="report_reason"
            aria-label="Reason"
            placeholder="Search reasons"
            options={REASONS.map((value) => ({ value, label: REPORT_REASON_LABELS[value] }))}
            selected={[reason]}
            onChange={(next) => {
              if (next[0]) setReason(next[0] as ContentReportReason);
            }}
          />
        </div>

        <div className="space-y-1.5 pt-1">
          <span className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5">
              <label htmlFor="report_details" className={FORM_LABEL}>
                Details
              </label>
              <FieldHelp concept="report_details" />
            </span>
            <CharCounter length={details.length} max={REPORT_DETAILS_MAX_LEN} />
          </span>
          <Textarea
            id="report_details"
            rows={3}
            maxLength={REPORT_DETAILS_MAX_LEN}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder="Anything the admin needs to judge this, in your own words."
          />
        </div>
      </ConfirmDialog>
    ),
  };
}
