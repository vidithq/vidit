"use client";

import type { EventDetail, EventVersion } from "@/types";
import { useVersionHistory } from "@/hooks/useVersionPage";
import { eventVersionsPath, eventVersions } from "@/lib/events";
import { EventVersionRow } from "@/components/event/EventVersionRow";
import { VersionHistory } from "@/components/event/VersionHistory";
import { PageShell } from "@/components/ui/PageShell";

/**
 * Every version of one event, newest first. Public so any reader can audit
 * corrections. A version's authorship is filed on the version it superseded, so
 * `eventVersions` holds back the oldest row of an unfinished walk until *Load
 * more* brings the page that completes it.
 */
export default function EventHistoryPage() {
  const { gate, record: geo, walk } = useVersionHistory<EventDetail, EventVersion>({
    recordPath: (id) => `/events/${id}`,
    versionsPath: eventVersionsPath,
  });
  if (gate) return gate;

  return (
    // Plain-text title: the *Current* row already links to the event.
    <PageShell back title="Version history" subtitle={geo.title}>
      <VersionHistory walk={walk}>
        {eventVersions(geo, walk.items, walk.hasMore).map((version) => (
          <EventVersionRow key={version.number} event={geo} version={version} />
        ))}
      </VersionHistory>
    </PageShell>
  );
}
