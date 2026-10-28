"use client";

import { useCallback } from "react";
import { useParams } from "next/navigation";

import type { EventDetail, EventVersion, EventVersionList } from "@/types";
import { useApiResource } from "@/hooks/useApiResource";
import { useCursorList } from "@/hooks/useCursorList";
import { eventVersionsPath, eventVersions } from "@/lib/events";
import { EventVersionRow } from "@/components/event/EventVersionRow";
import { VersionHistory } from "@/components/event/VersionHistory";
import { PageError, PageLoading, PageShell } from "@/components/ui/PageShell";

/** The history read answers an envelope; module-level because `useCursorList` keys fetches on this function's identity. */
const versionRows = (page: EventVersionList): EventVersion[] => page.items;

/**
 * Every version of one event, newest first. Public so any reader can audit
 * corrections. A version's authorship is filed on the version it superseded, so
 * `eventVersions` holds back the oldest row of an unfinished walk until *Load
 * more* brings the page that completes it.
 */
export default function EventHistoryPage() {
  const params = useParams();
  const eventId = typeof params.id === "string" ? params.id : "";
  const { data: geo, error, refetch } = useApiResource<EventDetail>(
    eventId ? `/events/${eventId}` : null
  );

  const buildPath = useCallback(
    (cursor: string | null) => eventVersionsPath(eventId, cursor),
    [eventId]
  );
  const walk = useCursorList<EventVersion, EventVersionList>(buildPath, versionRows);

  if (error) return <PageError error={error} onRetry={refetch} />;
  if (!geo) return <PageLoading />;

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
