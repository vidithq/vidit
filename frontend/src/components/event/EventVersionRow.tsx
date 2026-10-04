import Link from "next/link";

import type { EventVersionEntry } from "@/lib/events";
import { eventVersionHref } from "@/lib/events";
import { formatDate } from "@/lib/format";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { Pill } from "@/components/ui/Pill";
import { TAPPABLE_HOVER } from "@/components/ui/styles";

/** What this version did to the record, in the event page's words. Version 1 was published, not
 * edited, so it says so; an impossible comparison (a redacted version on either side) says nothing
 * rather than claim an empty edit; an edit that moved no versioned field says that, since the row
 * exists and the reader is owed the reason it looks unchanged. */
function changeSummary(version: EventVersionEntry): string | null {
  if (version.number === 1) return "Published";
  if (version.changed === null) return null;
  return version.changed.length === 0
    ? "No versioned field changed"
    : version.changed.join(", ");
}

/**
 * One version in an event's history: its number, what its edit changed, and who made it when. The
 * whole row is one click: a past version opens at its own address, the current one opens the
 * canonical `/events/{id}`. A redacted version keeps its number and byline and loses its content:
 * the row states the redaction where the changed fields would be and still links to the version,
 * which serves the same notice.
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
      {/* Stretched link: nothing inside the row competes for the click, so badges and byline sit under it. */}
      <Link
        href={version.current ? `/events/${eventId}` : eventVersionHref(eventId, version.number)}
        aria-label={`Version ${version.number}`}
        className="absolute inset-0 z-10 rounded-[inherit]"
      />
      <span className="flex shrink-0 items-center gap-1.5">
        {/* The number is a neutral label; the accent is for the state beside it. */}
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
            // Unlinked: an anchor under the stretched link is reached by z-order for the mouse but as a
            // separate stop for the keyboard, so the two would diverge. The profile is one tap from the
            // version this row opens.
            <AuthorByline author={version.editor} prefix={false} link={false} />
          )}
          {/* Dropped, like the byline, when the row carrying the edit's date can't be read: the line states
              what is known, not another version's date. */}
          {version.createdAt && <span>{formatDate(version.createdAt)}</span>}
        </div>
        {/* The editor's words, kept out of the metadata line so a long note wraps on its own. */}
        {version.note && (
          <p className="text-xs text-neutral-400 [overflow-wrap:anywhere]">{version.note}</p>
        )}
      </div>
    </div>
  );
}
