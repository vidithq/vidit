import type { ItemData } from "@/components/ui/Item";
import { Pill } from "@/components/ui/Pill";
import { SourceLabel } from "@/components/ui/SourceLabel";
import { batchCompletionBlockers } from "@/lib/events";
import { formatDate } from "@/lib/format";
import { eventItem } from "@/lib/items";
import { eventEditHref } from "@/lib/routes";
import { firstSourceUrl } from "@/lib/sources";
import type { DetectedVia, EventDetail } from "@/types";

/** The badge text for an incomplete detection, in the queue filter's word. One missing piece is
 * named (the common case, and it tells the analyst whether it is worth opening); several collapse
 * to a count, since joined names outgrew the row and the edit form names them in place. */
function incompleteLabel(blockers: string[]): string {
  return blockers.length === 1
    ? `Incomplete: ${blockers[0]}`
    : `Incomplete: ${blockers.length} pieces`;
}

/** Where a detection came in from, one word in the detail line. A detection imported before the
 * column existed carries no value and the segment is absent. Keyed on the generated
 * `detected_via` union, so a backend entry added alone fails type-check here instead of rendering
 * blank. */
const ENTRY_LABELS: Record<DetectedVia, string> = {
  bot: "Tagged the bot",
  paste: "Pasted",
  archive: "From your archive",
};

/**
 * One detection of the Detections queue as an item: the event's anatomy, with the source host and
 * the entry after the place, and a badge that describes the *evidence*, not completeness. **Ready
 * to review** means the machine found everything it could and the detection awaits the judgment a
 * review supplies (conflict, source kind), never that it is finished, so it takes the softer
 * outline tone. The queue filter's `?` explains the two states. The item opens the detection in
 * the edit form inside a review pass starting at it.
 */
export function detectionItem(detection: EventDetail): ItemData {
  const blockers = batchCompletionBlockers(detection);
  const ready = blockers.length === 0;
  const sourceUrl = firstSourceUrl(detection);
  return {
    ...eventItem({ ...detection, media: detection.thumbnail }),
    date: detection.occurred_date ? formatDate(detection.occurred_date) : "No event date",
    // No source link makes the detection incomplete, which its badge already says.
    extra: [
      sourceUrl !== null && <SourceLabel variant="inline" url={sourceUrl} />,
      detection.detected_via && ENTRY_LABELS[detection.detected_via],
    ],
    badge: (
      <Pill tone={ready ? "secondary" : "neutral"}>
        {ready ? "Ready to review" : incompleteLabel(blockers)}
      </Pill>
    ),
    href: eventEditHref(detection.id, true),
  };
}
