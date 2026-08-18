import Link from "next/link";

import { MediaThumb } from "@/components/ui/EntityCard";
import { Pill } from "@/components/ui/Pill";
import { SourceLabel } from "@/components/ui/SourceLabel";
import { TAPPABLE_HOVER } from "@/components/ui/styles";
import { batchCompletionBlockers, detectionEditPath } from "@/lib/events";
import { formatDate } from "@/lib/format";
import type { DetectedVia, EventDetail } from "@/types";

/**
 * The badge text for a detection still short of the evidence floor. One missing
 * piece is named, since that is the common case and the name is what tells the
 * analyst whether it is worth opening. Several collapse to a count: three names
 * joined into one badge outgrew the row, and the review flow and the edit form
 * both name them in place, which is where they get filled in.
 */
function missingLabel(blockers: string[]): string {
  return blockers.length === 1
    ? `Missing: ${blockers[0]}`
    : `Missing: ${blockers.length} pieces`;
}

/** Where a detection came in from, as the metadata line says it. One word beside
 *  the date and the source host, in the same secondary text: the three entries
 *  read one engine, so this answers "how did this reach me", not "how good is
 *  it". A detection imported before the column existed carries no value and the
 *  segment is simply absent, like a missing event date. Keyed on the generated
 *  `detected_via` union, so a fourth entry added on the backend fails type-check
 *  here instead of rendering a blank segment. */
const ENTRY_LABELS: Record<DetectedVia, string> = {
  bot: "Tagged the bot",
  paste: "Pasted",
  archive: "From your archive",
};

/**
 * One row of the Detections queue: a thumbnail, the title, the event date, the
 * source host, and one state badge. Deliberately denser and quieter than
 * `<EntityCard>` (no byline, no coordinates, no tags): the queue is a triage
 * list read top to bottom, and the judgment happens in the review flow, not
 * here. There are no inline controls, so the whole row stays one click, to the
 * full edit form, which is where a detection the review flow can't finish gets its
 * manual pass.
 *
 * The badge is the only state on the row, and it describes the *evidence*, not
 * completeness: **Ready to review** means the machine found everything it could
 * and the detection is waiting on the judgment a review supplies (the conflict and
 * the capture source), never that the detection is finished. It carries the softer
 * outline tone for that reason, so it cannot be read as a published or
 * complete state. What the two states mean is the queue filter's `?`, one for
 * the page: the row itself stays a label and a click.
 */
export function DetectionQueueRow({ detection }: { detection: EventDetail }) {
  const blockers = batchCompletionBlockers(detection);
  const ready = blockers.length === 0;
  return (
    <div
      className={`group relative flex gap-3 rounded-md border border-neutral-800 bg-neutral-900 p-2.5 ${TAPPABLE_HOVER}`}
    >
      {/* Stretched link, same click model as every other catalogue row: the
          whole row navigates, and nothing inside it competes for the click. It
          opens the detection inside a review pass, starting where it was clicked,
          since reaching a detection through the queue is reviewing the queue. */}
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
      {/* The badge shares the row from `sm` up and drops under the text on a
          phone, where a named-piece badge and a title can't both hold a
          column. */}
      <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
        <div className="min-w-0 flex-1 space-y-0.5">
          {/* Two lines, not one: a phone's column is narrow enough that a
              single truncated line cuts most machine titles mid-phrase. */}
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
        {/* Nothing on the row takes a pointer of its own, so the badge sits
            under the stretched link and the whole row, badge included, stays
            one click to the full form. */}
        <Pill tone={ready ? "secondary" : "neutral"} className="self-start">
          {ready ? "Ready to review" : missingLabel(blockers)}
        </Pill>
      </div>
    </div>
  );
}
