import Link from "next/link";

import type { EventVersionEntry } from "@/lib/events";
import { formatDate } from "@/lib/format";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { TEXT_LINK, WARNING_CALLOUT } from "@/components/ui/styles";

/**
 * What a `/events/{id}/vN` page says first: this is not the record as it stands. Amber, the caution
 * register: the reader isn't blocked, the way to the current version is in the same sentence, and
 * the link stays the app's one accent inside the amber card (the `design.md` callout split).
 *
 * The byline names who produced this version (the edit that superseded the one before); version 1
 * was published, not edited, and its date is the publication. A gone editor account leaves the
 * clause out, and so does an unreadable producing row for the date.
 */
export function EventVersionBanner({
  eventId,
  version,
  total,
}: {
  eventId: string;
  version: EventVersionEntry;
  total: number;
}) {
  return (
    <div className={`rounded-md px-4 py-3 text-sm ${WARNING_CALLOUT}`}>
      Version {version.number} of {total}
      {version.editor && (
        <>
          , {version.number === 1 ? "published" : "edited"} by{" "}
          <AuthorByline author={version.editor} prefix={false} />
        </>
      )}
      {version.createdAt && <> on {formatDate(version.createdAt)}</>}.{" "}
      <Link href={`/events/${eventId}`} className={TEXT_LINK}>
        View the current version
      </Link>
      .
    </div>
  );
}
