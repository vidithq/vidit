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
 * The reader's "something is wrong with this" control, on every detail surface.
 * One state machine, two nodes: `trigger` is the red flag icon button that
 * closes the utilities tier of the action row next to the share controls, and
 * `panel` is the form it opens, which the surface renders in its body where
 * there is room for a select and a textarea. Splitting them this way keeps the
 * affordance in the action row without a surface owning a second copy of the
 * reporting state. `useEventActions` assembles both into the event cluster, and
 * the collection page into its own.
 *
 * Icon-only, like the share pair beside it: the utilities tier is icon-compact,
 * so the flag carries the meaning and `aria-label` plus `title` carry the name.
 *
 * Red because reporting is the one destructive-in-intent thing a reader can do
 * to a published claim: it is the `danger` variant every other quiet
 * destructive trigger uses, not the loud `DANGER_CONFIRM` fill, which is
 * reserved for the armed second click of a two-click confirm.
 *
 * Works signed out. The people who most need to flag illegal or mislabelled
 * footage are the least likely to hold an account here, so the endpoint takes
 * an anonymous write and `apiFetch` omits the CSRF header when there is no
 * session cookie.
 *
 * The bucket is a `<Select>` rather than a `<SegmentedControl>`: five options,
 * two of them long, do not fit one exclusive-choice track at any width worth
 * having, and this is exactly the dense pick-one-from-a-short-list the field
 * is for. The reporter's own words are optional, because the bucket alone is
 * often the whole report.
 *
 * One hook for both things a reader can report, parameterised by `kind`: the
 * two endpoints take the same body under the same cap and answer the same way,
 * so a second copy of this form would only be a second place for the five
 * buckets and the two-thousand-character ceiling to drift.
 */

/** What this report is filed against. Mirrors the two report routes. */
export type ReportTargetKind = "event" | "collection";

// The call per kind, and the noun the copy uses for it. Keyed by the union, so
// a third target fails `tsc` here rather than reporting the wrong thing.
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

// The order the select offers, taken from the shared label map so the form and
// the admin queue name every bucket the same way.
const REASONS = Object.keys(REPORT_REASON_LABELS) as ContentReportReason[];

// The trigger sits in the header and the form in the body, so they are not DOM
// siblings; `aria-controls` is what ties the two together for a screen reader.
// One id for both kinds: a page reports one thing, so two of these forms are
// never open at once.
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

  // The hook outlives the row it reports on: the map panel and a client
  // navigation from one detail page to the next both keep this component
  // mounted and swap `targetId` under it. Without this reset an open form, a
  // typed reason, half-written details, or the "report received" receipt all
  // carry over to the next row, and the receipt would hide the trigger for
  // something the reader has not reported at all.
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

  // The receipt replaces both nodes for the rest of the visit: a second report
  // of the same row from the same reader adds nothing.
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
      // Only while the form is mounted: `aria-controls` pointing at an id that
      // is not in the document is a dangling reference.
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
