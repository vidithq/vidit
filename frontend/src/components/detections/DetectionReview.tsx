"use client";

import { useState } from "react";

import { EventEditForm } from "@/components/geolocations/edit/EventEditForm";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageShell } from "@/components/ui/PageShell";
import { LABEL_TEXT } from "@/components/ui/form-styles";
import type { EventDetail } from "@/types";

interface DetectionReviewProps {
  /** The batch this session steps through, in queue order. */
  drafts: EventDetail[];
  /** Everything still pending, which can exceed the loaded batch. */
  total: number;
  /** Back to the queue list. */
  queueHref: string;
  /** Load the next batch once this one is reviewed. */
  onReload: () => void;
}

/**
 * The review session: the shared edit surface, one draft at a time, in queue
 * order. Reviewing a draft and editing one are the same form, so every field
 * (the proof included) works the same on both routes and neither can drift.
 *
 * The session adds three things: the position, a Skip that moves on without
 * writing, and the advance to the next draft that follows a publish or a
 * rejection, in place of the edit page's return to the queue.
 *
 * The batch is a snapshot, stepped through locally and never refetched
 * mid-session: a published row leaves the server-side queue, so refetching
 * after each publish would shift every later draft's position under the
 * analyst and skip one per publish.
 */
export function DetectionReview({
  drafts,
  total,
  queueHref,
  onReload,
}: DetectionReviewProps) {
  const [index, setIndex] = useState(0);
  const advance = () => setIndex((i) => i + 1);
  const draft = drafts[index];

  if (!draft) {
    const left = total - drafts.length;
    return (
      <PageShell back backFallback={queueHref} title="Review detections">
        <EmptyState
          variant="plain"
          lead={
            drafts.length === 0
              ? "No detections to review."
              : "You reached the end of this batch."
          }
          cta={
            left > 0 && (
              <Button
                variant="primary"
                onClick={() => {
                  setIndex(0);
                  onReload();
                }}
              >
                Review the next batch
              </Button>
            )
          }
        >
          {left > 0
            ? `${left} more ${left === 1 ? "draft is" : "drafts are"} waiting in the queue.`
            : "Every draft in the queue has been through a pass."}
        </EmptyState>
      </PageShell>
    );
  }

  return (
    // Keyed on the draft: every field is seeded from the row, so the next draft
    // has to arrive on a fresh form rather than on the previous one's state.
    <EventEditForm
      key={draft.id}
      geo={draft}
      redirectTo={queueHref}
      review={{
        backFallback: queueHref,
        onDone: advance,
        chrome: (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <span className={LABEL_TEXT}>
              Draft {index + 1} of {drafts.length}
              {total > drafts.length && ` · ${total} in the queue`}
            </span>
            <Button variant="secondary" onClick={advance}>
              Skip
            </Button>
          </div>
        ),
      }}
    />
  );
}
