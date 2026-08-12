import Link from "next/link";

import { MediaThumb } from "@/components/ui/EntityCard";
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
 * joined into one badge outgrew the row, and the full list rides along in the
 * `title` for a pointer, with the review flow and the edit form both naming
 * them in place.
 */
function missingLabel(blockers: string[]): string {
  return blockers.length === 1
    ? `Missing: ${blockers[0]}`
    : `Missing: ${blockers.length} pieces`;
}

/** The hover text behind the missing badge: the names in full, whether or not
 *  the badge collapsed them, plus what the analyst is meant to do about it. A
 *  count on its own says how bad it is without saying what it is. */
function missingTitle(blockers: string[]): string {
  const them = blockers.length === 1 ? "it" : "them";
  return `Still missing: ${blockers.join(", ")}. A review can't supply ${them}, so open the draft on the full form to fill it in.`;
}

/** The hover text behind the ready badge. The word "ready" invites the reading
 *  that the draft is finished, so the title says outright what is done and what
 *  is still owed. */
const READY_TITLE =
  "The import found every piece of evidence this draft needs. Reviewing it adds the conflict and the capture source, then publishes it.";

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
 * complete state, and both states carry hover text spelling out what the badge
 * means and what to do next.
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
        {/* `relative z-20` lifts the badge over the stretched link, the same
            way `EntityCard` lifts its byline and its source label. Without it
            the element under the pointer is the link covering the whole row,
            which carries no title of its own and does not lend the badge's, so
            the hover text never appears (the `ArchivedCopies` failure, by a
            different route: there a glyph covered the titled element, here the
            click target does). Verified with `elementFromPoint` over all three
            badge states in Chrome. The cost is that the badge itself no longer
            navigates; the rest of the row still does. */}
        <Pill
          tone={ready ? "secondary" : "neutral"}
          title={ready ? READY_TITLE : missingTitle(blockers)}
          className="relative z-20 self-start"
        >
          {ready ? "Ready to review" : missingLabel(blockers)}
        </Pill>
      </div>
    </div>
  );
}
