"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Flag } from "lucide-react";

import { reportCollection } from "@/lib/collections";
import {
  REPORT_DETAILS_MAX_LEN,
  REPORT_REASON_LABELS,
  reportEvent,
  type ContentReport,
  type ContentReportReason,
} from "@/lib/events";
import { useMutation } from "@/hooks/useMutation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Select, Textarea } from "@/components/ui/Input";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import {
  FORM_ERROR_BANNER,
  FORM_LABEL,
  FORM_SUCCESS_BANNER,
} from "@/components/ui/form-styles";

/**
 * The reader's "something is wrong with this" control, on every detail surface. One state machine,
 * two nodes: `trigger` is the red flag icon button closing the utilities tier next to the share
 * controls, and `panel` is the form it opens, rendered in the surface's body where a select and
 * textarea fit. `useEventActions` assembles both into the event cluster, and the collection page
 * into its own.
 *
 * Icon-only like the share pair: `aria-label` plus `title` carry the name. Red because reporting
 * is the destructive-in-intent act a reader can do to a published claim: the `danger` variant of
 * quiet destructive triggers, not the loud `DANGER_CONFIRM` fill reserved for an armed second click.
 *
 * Works signed out: those who most need to flag illegal or mislabelled footage rarely hold an
 * account, so the endpoint takes an anonymous write and `apiFetch` omits the CSRF header with no
 * session cookie.
 *
 * The bucket is a `<Select>`, not a `<SegmentedControl>`: five options, two long, don't fit one
 * exclusive-choice track. The reporter's words are optional, since the bucket is often the whole
 * report.
 *
 * One hook for both reportable kinds, parameterised by `kind`: the two endpoints take the same
 * body under the same cap, so a second copy would be a second place for the buckets and the
 * 2000-character ceiling to drift.
 */

/** What this report is filed against. Mirrors the two report routes. */
export type ReportTargetKind = "event" | "collection";

// The call per kind and the noun the copy uses, keyed by the union so a third target fails `tsc` here.
const SUBMIT: Record<
  ReportTargetKind,
  (id: string, body: { reason: ContentReportReason; details: string | null }) => Promise<ContentReport>
> = {
  event: reportEvent,
  collection: reportCollection,
};

const NOUN: Record<ReportTargetKind, string> = {
  event: "event",
  collection: "collection",
};

// The select's order, from the shared label map so the form and the admin queue name buckets alike.
const REASONS = Object.keys(REPORT_REASON_LABELS) as ContentReportReason[];

// The trigger (header) and form (body) aren't DOM siblings, so `aria-controls` ties them. One id
// for both kinds: a page reports one thing.
const FORM_ID = "report-content-form";

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
      aria-expanded={open}
      // Only while the form is mounted: `aria-controls` to an absent id is a dangling reference.
      aria-controls={open ? FORM_ID : undefined}
      onClick={() => {
        reportMutation.reset();
        setOpen((prev) => !prev);
      }}
    >
      <Flag size={14} />
    </Button>
  );

  if (!open) return { trigger, panel: null };

  return {
    trigger,
    panel: (
      <div id={FORM_ID}>
        <Card as="section">
          <header>
            <SectionEyebrow
              title={`Report this ${NOUN[kind]}`}
              margin="none"
            />
            <p className="text-xs text-neutral-500 mt-0.5">
              No account needed. Say what is wrong with it and an admin reviews
              the {NOUN[kind]}.
            </p>
          </header>

          <div className="space-y-1.5">
            <label htmlFor="report_reason" className={FORM_LABEL}>
              Reason
            </label>
            <Select
              id="report_reason"
              value={reason}
              onChange={(e) => setReason(e.target.value as ContentReportReason)}
              className="max-w-xs"
            >
              {REASONS.map((value) => (
                <option key={value} value={value}>
                  {REPORT_REASON_LABELS[value]}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="report_details" className={FORM_LABEL}>
              Details (optional)
            </label>
            <Textarea
              id="report_details"
              rows={3}
              maxLength={REPORT_DETAILS_MAX_LEN}
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="Anything the admin needs to judge this, in your own words."
            />
          </div>

          {reportMutation.error && (
            <div className={FORM_ERROR_BANNER} role="alert">
              {reportMutation.error}
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button
              variant="primary"
              onClick={() => void reportMutation.run()}
              disabled={busy}
            >
              {busy ? "Sending…" : "Send report"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        </Card>
      </div>
    ),
  };
}
