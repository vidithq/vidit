import type { EventVersionEntry } from "@/lib/events";
import { eventVersioned, VERSION_ZERO_META } from "@/lib/events";
import { EVENT_STATUS_META } from "@/components/event/StatusBadge";
import { VersionRow } from "@/components/event/VersionRow";
import type { EventDetail } from "@/types";

/** What this version did to the record, in the event page's words. Version 0 was opened and
 * version 1 published, not edited, so each says so; an impossible comparison (a redacted version on either side) says nothing
 * rather than claim an empty edit; an edit that moved no versioned field says that, since the row
 * exists and the reader is owed the reason it looks unchanged. */
function changeSummary(
  version: EventVersionEntry,
  versionZero: EventDetail["version_zero"]
): string | null {
  if (version.number === 0) {
    return versionZero ? EVENT_STATUS_META[VERSION_ZERO_META[versionZero].status].label : null;
  }
  if (version.number === 1) return "Published";
  if (version.changed === null) return null;
  return version.changed.length === 0
    ? "No versioned field changed"
    : version.changed.join(", ");
}

/** One version in an event's history: `VersionRow` named *Detection* or *Request* for version 0,
 *  else *vN*, with what its edit changed. */
export function EventVersionRow({
  event,
  version,
}: {
  event: Pick<EventDetail, "id" | "version_no" | "version_zero">;
  version: EventVersionEntry;
}) {
  return (
    <VersionRow
      record={eventVersioned(event)}
      version={version}
      summary={changeSummary(version, event.version_zero)}
    />
  );
}
