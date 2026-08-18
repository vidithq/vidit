import Link from "next/link";

import type { EventVersion } from "@/lib/events";
import { formatDate } from "@/lib/format";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { TEXT_LINK, WARNING_CALLOUT } from "@/components/ui/styles";

/**
 * What a `/events/{id}/vN` page says before anything else: this is not the
 * record as it stands.
 *
 * Amber, the caution register: the reader is not blocked, they are reading
 * something superseded, and the way to the current version is in the same
 * sentence. The link is orange inside the amber card, the split
 * `design.md` holds every callout to: the card is the warning, the clickable
 * affordance stays the app's one accent.
 *
 * The byline names who produced this version, which is the edit that
 * superseded the one before it; version 1 was published rather than edited, so
 * it says so. An editor whose account is gone leaves the clause out rather than
 * naming nobody.
 */
export function EventVersionBanner({
  eventId,
  version,
  total,
}: {
  eventId: string;
  version: EventVersion;
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
      )}{" "}
      on {formatDate(version.createdAt)}.{" "}
      <Link href={`/events/${eventId}`} className={TEXT_LINK}>
        View the current version
      </Link>
      .
    </div>
  );
}
