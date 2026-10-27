import {
  eventVersioned,
  versionLabel,
  VERSION_ZERO_META,
  type EventVersionEntry,
} from "@/lib/events";
import { VersionBanner } from "@/components/event/VersionBanner";
import type { EventDetail } from "@/types";

/**
 * The event's `VersionBanner`. The byline names who produced this version (the edit that
 * superseded the one before); version 0 is the request or the detection the event was published
 * from, opened rather than edited, and version 1 was published, its date the publication.
 */
export function EventVersionBanner({
  event,
  version,
}: {
  event: Pick<EventDetail, "id" | "version_no" | "version_zero">;
  version: EventVersionEntry;
}) {
  const zero = version.number === 0;
  const verb =
    zero && event.version_zero
      ? VERSION_ZERO_META[event.version_zero].verb
      : version.number === 1
        ? "published"
        : "edited";
  return (
    <VersionBanner
      record={eventVersioned(event)}
      version={version}
      verb={verb}
      lead={
        zero
          ? `The ${versionLabel(event, 0).toLowerCase()} this event was published from`
          : undefined
      }
    />
  );
}
