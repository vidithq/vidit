import Link from "next/link";

import { versionLabel, VERSION_ZERO_META, type EventVersionEntry } from "@/lib/events";
import { formatDate } from "@/lib/format";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { TEXT_LINK, WARNING_CALLOUT } from "@/components/ui/styles";
import { eventHref } from "@/lib/routes";
import type { EventDetail } from "@/types";

/**
 * What a `/events/{id}/vN` page says first: this is not the record as it stands. Amber, the caution
 * register: the reader isn't blocked, the way to the current version is in the same sentence, and
 * the link stays the app's one accent inside the amber card (the `design.md` callout split).
 *
 * The byline names who produced this version (the edit that superseded the one before); version 0
 * is the request or the detection the event was published from, opened rather than edited, and
 * version 1 was published, its date the publication. A gone editor account leaves the clause out,
 * and so does an unreadable producing row for the date.
 */
export function EventVersionBanner({
  event,
  version,
}: {
  event: Pick<EventDetail, "id" | "version_no" | "version_zero">;
  version: EventVersionEntry;
}) {
  const eventId = event.id;
  const verb =
    version.number === 0 && event.version_zero
      ? VERSION_ZERO_META[event.version_zero].verb
      : version.number === 1
        ? "published"
        : "edited";
  return (
    <div className={`rounded-md px-4 py-3 text-sm ${WARNING_CALLOUT}`}>
      {version.number === 0
        ? `The ${versionLabel(event, 0).toLowerCase()} this event was published from`
        : `Version ${version.number} of ${event.version_no}`}
      {version.editor && (
        <>
          , {verb} by <AuthorByline author={version.editor} prefix={false} />
        </>
      )}
      {version.createdAt && <> on {formatDate(version.createdAt)}</>}.{" "}
      <Link href={eventHref(eventId)} className={TEXT_LINK}>
        View the current version
      </Link>
      .
    </div>
  );
}
