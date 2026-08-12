import Link from "next/link";

import { MediaThumb } from "@/components/ui/EntityCard";
import { FieldHelp } from "@/components/ui/FieldHelp";
import { Pill } from "@/components/ui/Pill";
import { SourceLabel } from "@/components/ui/SourceLabel";
import { TAPPABLE_HOVER } from "@/components/ui/styles";
import { batchCompletionBlockers, sourceIsSynthetic } from "@/lib/events";
import { formatDate } from "@/lib/format";
import type { EventDetail } from "@/types";

/**
 * The badge text for a draft still short of the evidence floor. One missing
 * piece is named, since that is the common case and the name is what tells the
 * analyst whether it is worth opening. Several collapse to a count: three names
 * joined into one badge outgrew the row, and the `?` beside the badge names
 * them in full, with the review flow and the edit form both naming them in
 * place.
 */
function missingLabel(blockers: string[]): string {
  return blockers.length === 1
    ? `Missing: ${blockers[0]}`
    : `Missing: ${blockers.length} pieces`;
}

/** What the `?` beside the missing badge says: the names in full, whether or
 *  not the badge collapsed them, plus what the analyst is meant to do about it.
 *  A count on its own says how bad it is without saying what it is. This is the
 *  one place a `FieldHelp` takes instance text, the pieces being this row's
 *  data rather than a concept. */
function missingText(blockers: string[]): string {
  const them = blockers.length === 1 ? "it" : "them";
  return `Still missing: ${blockers.join(", ")}. A review can't supply ${them}, so open the draft on the full form to fill it in.`;
}

/**
 * One row of the Detections queue: a thumbnail, the title, the event date, the
 * source host, and one state badge. Deliberately denser and quieter than
 * `<EntityCard>` (no byline, no coordinates, no tags): the queue is a triage
 * list read top to bottom, and the judgment happens in the review flow, not
 * here. There are no inline controls, so the whole row stays one click, to the
 * full edit form, which is where a draft the review flow can't finish gets its
 * manual pass.
 *
 * The badge is the only state on the row, and it describes the *evidence*, not
 * completeness: **Ready to review** means the machine found everything it could
 * and the draft is waiting on the judgment a review supplies (the conflict and
 * the capture source), never that the draft is finished. It carries the softer
 * outline tone for that reason, so it cannot be read as a published or
 * complete state. What the two states mean is the queue filter's `?`, one for
 * the page; the incomplete badge carries a `?` of its own, since which pieces
 * are missing is this row's own data.
 */
export function DetectionQueueRow({ draft }: { draft: EventDetail }) {
  const blockers = batchCompletionBlockers(draft);
  const ready = blockers.length === 0;
  return (
    <div
      className={`group relative flex gap-3 rounded-md border border-neutral-800 bg-neutral-900 p-2.5 ${TAPPABLE_HOVER}`}
    >
      {/* Stretched link, same click model as every other catalogue row: the
          whole row navigates, and nothing inside it competes for the click. */}
      <Link
        href={`/events/${draft.id}/edit`}
        aria-label={draft.title}
        className="absolute inset-0 z-10 rounded-[inherit]"
      />
      <MediaThumb media={draft.thumbnail ?? undefined} className="w-16" />
      {/* The badge shares the row from `sm` up and drops under the text on a
          phone, where a named-piece badge and a title can't both hold a
          column. */}
      <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
        <div className="min-w-0 flex-1 space-y-0.5">
          {/* Two lines, not one: a phone's column is narrow enough that a
              single truncated line cuts most machine titles mid-phrase. */}
          <h3 className="line-clamp-2 text-sm font-medium text-neutral-100 group-hover:text-orange-400">
            {draft.title}
          </h3>
          <div className="flex flex-wrap items-center gap-x-3 text-[11px] text-neutral-500">
            <span>
              {draft.event_date ? formatDate(draft.event_date) : "No event date"}
            </span>
            <SourceLabel
              variant="inline"
              url={draft.source_url}
              isDemo={sourceIsSynthetic(draft)}
            />
          </div>
        </div>
        {/* `relative z-20` lifts the badge and its `?` over the stretched link,
            the same way `EntityCard` lifts its byline and its source label:
            without it the link covering the whole row takes the pointer, and
            the `?` would neither hover nor click. The cost is that the badge
            itself no longer navigates; the rest of the row still does, and the
            `?` swallows its own click rather than opening the draft. */}
        <span className="relative z-20 flex items-center gap-1 self-start">
          <Pill tone={ready ? "secondary" : "neutral"}>
            {ready ? "Ready to review" : missingLabel(blockers)}
          </Pill>
          {/* Only on the incomplete badge: what "Ready to review" means is the
              filter's concept, one `?` for the whole page, rather than the same
              sentence repeated on every ready row. */}
          {!ready && (
            <FieldHelp concept="detection_missing" text={missingText(blockers)} size={12} />
          )}
        </span>
      </div>
    </div>
  );
}
