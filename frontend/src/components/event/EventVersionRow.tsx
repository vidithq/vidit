import Link from "next/link";

import type { EventVersionEntry } from "@/lib/events";
import { eventVersionHref } from "@/lib/events";
import { formatDate } from "@/lib/format";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { Pill } from "@/components/ui/Pill";
import { TAPPABLE_HOVER } from "@/components/ui/styles";

/**
 * What this version did to the record, in the words the event page uses for the
 * same values. Version 1 was published rather than edited, so it says so; a
 * comparison that cannot be made (a redacted version on either side) says
 * nothing rather than claiming an empty edit; and an edit that moved no
 * versioned field says that too, since the row exists and the reader is owed
 * the reason it looks unchanged.
 */
function changeSummary(version: EventVersionEntry): string | null {
  if (version.number === 1) return "Published";
  if (version.changed === null) return null;
  return version.changed.length === 0
    ? "No versioned field changed"
    : version.changed.join(", ");
}

/**
 * One version in an event's history: which version it is, what its edit
 * changed, and who made that edit when.
 *
 * The whole row is one click, the click model every catalogue row uses: a past
 * version opens at its own address, and the current version opens the canonical
 * `/events/{id}`, since that is where the record as it stands is read.
 *
 * A redacted version keeps its number and its byline and loses its content, so
 * the row states the redaction where the changed fields would be and still
 * links to the version, which serves the same notice.
 */
export function EventVersionRow({
  eventId,
  version,
}: {
  eventId: string;
  version: EventVersionEntry;
}) {
  const summary = changeSummary(version);
  return (
    <div
      className={`group relative flex flex-col gap-1 rounded-md border border-neutral-800 bg-neutral-900 p-2.5 sm:flex-row sm:items-center sm:gap-3 ${TAPPABLE_HOVER}`}
    >
      {/* Stretched link: nothing inside the row competes for the click, so the
          badges and the byline stay under it and the whole row navigates. */}
      <Link
        href={version.current ? `/events/${eventId}` : eventVersionHref(eventId, version.number)}
        aria-label={`Version ${version.number}`}
        className="absolute inset-0 z-10 rounded-[inherit]"
      />
      <span className="flex shrink-0 items-center gap-1.5">
        {/* The number is a label on every row, so it stays neutral; the state
            beside it is what the accent is for. */}
        <Pill tone="neutral">v{version.number}</Pill>
        {version.current && <Pill tone="accent">Current</Pill>}
        {version.redacted && <Pill tone="danger">Redacted</Pill>}
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        {summary && (
          <p className="text-sm text-neutral-100 group-hover:text-orange-400">{summary}</p>
        )}
        <div className="flex flex-wrap items-center gap-x-3 text-[11px] text-neutral-500">
          {version.editor && (
            // Unlinked: the row is one click, and an anchor under the stretched
            // link is a target the mouse reaches by z-order while the keyboard
            // reaches it as a separate stop, so the two diverge on what the row
            // does. The handle stays readable, and the profile is one tap away
            // from the version this row opens.
            <AuthorByline author={version.editor} prefix={false} link={false} />
          )}
          {/* Dropped, like the byline beside it, when the row that carries the
              edit's date could not be read: the metadata line states what is
              known rather than filling the gap with another version's date. */}
          {version.createdAt && <span>{formatDate(version.createdAt)}</span>}
        </div>
        {/* The editor's own words about the edit, kept out of the metadata line
            so a long note wraps on its own rather than pushing the date away. */}
        {version.note && (
          <p className="text-xs text-neutral-400 [overflow-wrap:anywhere]">{version.note}</p>
        )}
      </div>
    </div>
  );
}
