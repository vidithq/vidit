"use client";

import { useState, type ReactNode } from "react";
import { Flag } from "lucide-react";

import {
  REPORT_DETAILS_MAX_LEN,
  reportEvent,
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
 * The reader's "something is wrong with this" control, on the event and
 * request detail pages. One state machine, two nodes: `trigger` is the red
 * `Report` button the page puts in its header next to the share actions, and
 * `panel` is the form it opens, which the page renders in its body where there
 * is room for a select and a textarea. Splitting them this way keeps the
 * affordance in the action row without either page owning a second copy of the
 * reporting state.
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
 */

// The human label per bucket. Keyed by the generated union, so a new backend
// reason fails `tsc` here instead of rendering as a raw enum value.
const REASON_LABELS: Record<ContentReportReason, string> = {
  illegal_content: "Illegal content",
  graphic_not_flagged: "Graphic content, not flagged",
  copyright: "Copyright",
  privacy: "Privacy",
  other: "Something else",
};

const REASONS = Object.keys(REASON_LABELS) as ContentReportReason[];

// The trigger sits in the header and the form in the body, so they are not DOM
// siblings; `aria-controls` is what ties the two together for a screen reader.
const FORM_ID = "report-event-form";

export function useReportEvent(eventId: string): {
  trigger: ReactNode;
  panel: ReactNode;
} {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ContentReportReason>("illegal_content");
  const [details, setDetails] = useState("");
  const [sent, setSent] = useState(false);

  const reportMutation = useMutation(
    () =>
      reportEvent(eventId, {
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
  // of the same event from the same reader adds nothing.
  if (sent) {
    return {
      trigger: null,
      panel: (
        <div className={FORM_SUCCESS_BANNER} role="status">
          Report received. An admin reviews it and decides what happens to the
          event.
        </div>
      ),
    };
  }

  const trigger = (
    <Button
      variant="danger"
      aria-expanded={open}
      aria-controls={FORM_ID}
      onClick={() => {
        reportMutation.reset();
        setOpen((prev) => !prev);
      }}
    >
      <Flag size={14} />
      Report
    </Button>
  );

  if (!open) return { trigger, panel: null };

  return {
    trigger,
    panel: (
      <div id={FORM_ID}>
        <Card as="section">
          <header>
            <SectionEyebrow title="Report this event" margin="none" />
            <p className="text-xs text-neutral-500 mt-0.5">
              No account needed. Say what is wrong with it and an admin reviews
              the event.
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
                  {REASON_LABELS[value]}
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
