"use client";

import { useState } from "react";
import Link from "next/link";

import { ReviewDraft } from "@/components/detections/ReviewDraft";
import { Button, buttonClasses } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pill } from "@/components/ui/Pill";
import { LABEL_TEXT } from "@/components/ui/form-styles";
import { TEXT_LINK } from "@/components/ui/styles";
import type { Conflict, EventDetail, Tag } from "@/types";

interface DetectionReviewProps {
  /** The batch this session steps through, in queue order. */
  drafts: EventDetail[];
  /** Everything still pending, which can exceed the loaded batch. */
  total: number;
  /** The curated taxonomy; the `capture_source` rows feed the pick-one field. */
  curatedTags: Tag[];
  conflicts: Conflict[];
  /** Back to the queue list. */
  queueHref: string;
  /** Load the next batch once this one is reviewed. */
  onReload: () => void;
}

/**
 * The review session: one draft at a time, in queue order, with a progress
 * count and the two picks that stick.
 *
 * The batch is a snapshot, stepped through locally and never refetched
 * mid-session: a published row leaves the server-side queue, so refetching
 * after each publish would shift every later draft's position under the
 * analyst and skip one per publish.
 *
 * The conflict and the capture source live here rather than in the draft, which
 * is what makes them sticky: a pick made on one draft is the value the next one
 * opens with. An import is usually one conflict and a handful of capture
 * sources, so the common pass is Publish, Publish, Publish. They are seeded
 * from the first draft's own tags, whatever the import already knew.
 */
export function DetectionReview({
  drafts,
  total,
  curatedTags,
  conflicts,
  queueHref,
  onReload,
}: DetectionReviewProps) {
  const [index, setIndex] = useState(0);
  const [conflictIds, setConflictIds] = useState<string[]>(
    () => drafts[0]?.conflicts.map((c) => c.id) ?? []
  );
  const [captureSourceId, setCaptureSourceId] = useState<string>(
    () => drafts[0]?.tags.find((t) => t.category === "capture_source")?.id ?? ""
  );

  const captureSources = curatedTags.filter((t) => t.category === "capture_source");
  const draft = drafts[index];

  if (!draft) {
    const left = total - drafts.length;
    return (
      <EmptyState
        variant="plain"
        lead={
          drafts.length === 0
            ? "No detections to review."
            : "You reached the end of this batch."
        }
        cta={
          <>
            {left > 0 && (
              <Button
                variant="primary"
                onClick={() => {
                  setIndex(0);
                  onReload();
                }}
              >
                Review the next batch
              </Button>
            )}
            <Link href={queueHref} className={buttonClasses(left > 0 ? "ghost" : "primary")}>
              Back to the queue
            </Link>
          </>
        }
      >
        {left > 0
          ? `${left} more ${left === 1 ? "draft is" : "drafts are"} waiting in the queue.`
          : "Every draft in the queue has been through a pass."}
      </EmptyState>
    );
  }

  return (
    <div className="space-y-4">
      {/* The session's header: where you are, what the keys do, and the way
          out. The legend sits here rather than beside the actions it drives,
          so it is on screen from the first draft without a scroll, which is
          the only way a shortcut gets learned. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className={LABEL_TEXT}>
            Draft {index + 1} of {drafts.length}
            {total > drafts.length && ` · ${total} in the queue`}
          </span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-neutral-500">
            <Shortcut keyLabel="Enter">publish</Shortcut>
            <Shortcut keyLabel="S">skip</Shortcut>
            <Shortcut keyLabel="X">reject</Shortcut>
          </span>
        </div>
        <Link href={queueHref} className={`text-xs ${TEXT_LINK}`}>
          Back to the queue
        </Link>
      </div>

      {/* Keyed on the draft: every per-draft field is seeded from props, so a
          new draft has to arrive on a fresh component rather than on stale
          state. The two picks sit above this boundary and survive it. */}
      <ReviewDraft
        key={draft.id}
        draft={draft}
        conflicts={conflicts}
        captureSources={captureSources}
        conflictIds={conflictIds}
        setConflictIds={setConflictIds}
        captureSourceId={captureSourceId}
        setCaptureSourceId={setCaptureSourceId}
        onAdvance={() => setIndex((i) => i + 1)}
      />
    </div>
  );
}

/** One entry of the shortcut legend: the key as a `<Pill>` (the badge family
 *  already owns that shape) plus what it does. */
function Shortcut({
  keyLabel,
  children,
}: {
  keyLabel: string;
  children: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Pill tone="neutral">{keyLabel}</Pill>
      {children}
    </span>
  );
}
