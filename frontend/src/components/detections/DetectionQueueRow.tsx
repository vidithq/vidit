import Link from "next/link";

import { MediaThumb } from "@/components/ui/EntityCard";
import { Pill } from "@/components/ui/Pill";
import { SourceLabel } from "@/components/ui/SourceLabel";
import { TAPPABLE_HOVER } from "@/components/ui/styles";
import { batchCompletionBlockers, detectionEditPath } from "@/lib/events";
import { formatDate } from "@/lib/format";
import type { DetectedVia, EventDetail } from "@/types";

/** The badge text for a detection short of the evidence floor. One missing piece is named (the
 * common case, and it tells the analyst whether it is worth opening); several collapse to a count,
 * since joined names outgrew the row and the review flow and edit form name them in place. */
function missingLabel(blockers: string[]): string {
  return blockers.length === 1
    ? `Missing: ${blockers[0]}`
    : `Missing: ${blockers.length} pieces`;
}

/** Where a detection came in from, one word in the secondary metadata line. A detection imported
 * before the column existed carries no value and the segment is absent. Keyed on the generated
 * `detected_via` union, so a backend entry added alone fails type-check here instead of rendering
 * blank. */
const ENTRY_LABELS: Record<DetectedVia, string> = {
  bot: "Tagged the bot",
  paste: "Pasted",
  archive: "From your archive",
};

/**
 * One row of the Detections queue: thumbnail, title, event date, source host, one state badge.
 * Denser and quieter than `<EntityCard>` (no byline, coordinates or tags): the queue is a triage
 * list and judgment happens in the review flow. No inline controls, so the whole row is one click
 * to the full edit form, where a detection the review flow can't finish gets its manual pass.
 *
 * The badge describes the *evidence*, not completeness: **Ready to review** means the machine
 * found everything it could and the detection awaits the judgment a review supplies (conflict,
 * capture source), never that it is finished. It takes the softer outline tone so it can't read as
 * a published state. The queue filter's `?` explains the two states.
 */
export function DetectionQueueRow({ detection }: { detection: EventDetail }) {
  const blockers = batchCompletionBlockers(detection);
  const ready = blockers.length === 0;
  return (
    <div
      className={`group relative flex gap-3 rounded-md border border-neutral-800 bg-neutral-900 p-2.5 ${TAPPABLE_HOVER}`}
    >
      {/* Stretched link, the catalogue row click model. It opens the detection inside a review pass
          starting where it was clicked: reaching a detection through the queue is reviewing the queue. */}
      <Link
        href={detectionEditPath(detection.id, true)}
        aria-label={detection.title}
        className="absolute inset-0 z-10 rounded-[inherit]"
      />
      <MediaThumb
        media={detection.thumbnail ?? undefined}
        isGraphic={detection.is_graphic}
        className="w-16"
      />
      {/* The badge shares the row from `sm` up and drops under the text on a phone, where badge and
          title can't share a column. */}
      <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
        <div className="min-w-0 flex-1 space-y-0.5">
          {/* Two lines: on a phone a single truncated line cuts most machine titles mid-phrase. */}
          <h3 className="line-clamp-2 text-sm font-medium text-neutral-100 group-hover:text-orange-400">
            {detection.title}
          </h3>
          <div className="flex flex-wrap items-center gap-x-3 text-[11px] text-neutral-500">
            <span>
              {detection.event_date ? formatDate(detection.event_date) : "No event date"}
            </span>
            <SourceLabel variant="inline" url={detection.source_url} />
            {detection.detected_via !== null && detection.detected_via !== undefined && (
              <span>{ENTRY_LABELS[detection.detected_via]}</span>
            )}
          </div>
        </div>
        {/* Nothing on the row takes a pointer of its own, so the badge sits under the stretched link and
            the row stays one click. */}
        <Pill tone={ready ? "secondary" : "neutral"} className="self-start">
          {ready ? "Ready to review" : missingLabel(blockers)}
        </Pill>
      </div>
    </div>
  );
}
