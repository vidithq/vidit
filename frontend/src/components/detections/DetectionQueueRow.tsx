import Link from "next/link";

import { MediaThumb } from "@/components/ui/EntityCard";
import { Pill } from "@/components/ui/Pill";
import { SourceLabel } from "@/components/ui/SourceLabel";
import { TAPPABLE_HOVER } from "@/components/ui/styles";
import { batchCompletionBlockers, sourceIsSynthetic } from "@/lib/events";
import { formatDate } from "@/lib/format";
import type { EventDetail } from "@/types";

/**
 * One row of the Detections queue: a thumbnail, the title, the event date, the
 * source host, and one state badge. Deliberately denser and quieter than
 * `<EntityCard>` (no byline, no coordinates, no tags): the queue is a triage
 * list read top to bottom, and the judgment happens in the review flow, not
 * here. There are no inline controls, so the whole row stays one click, to the
 * full edit form, which is where a draft the review flow can't finish gets its
 * manual pass.
 *
 * The badge is the only state on the row: **ready** when the draft carries the
 * whole evidence floor and needs only the two human choices, otherwise the
 * pieces it is missing, named.
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
          phone, where a named-pieces badge and a title can't both hold a
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
        <Pill
          tone={ready ? "accent" : "neutral"}
          className="self-start whitespace-normal text-left sm:max-w-[13rem]"
        >
          {ready ? "Ready" : `Missing: ${blockers.join(", ")}`}
        </Pill>
      </div>
    </div>
  );
}
