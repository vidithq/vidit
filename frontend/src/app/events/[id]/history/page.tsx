"use client";

import { useCallback } from "react";
import { useParams } from "next/navigation";

import type { EventDetail, EventVersion, EventVersionList } from "@/types";
import { useApiResource } from "@/hooks/useApiResource";
import { useCursorList } from "@/hooks/useCursorList";
import { eventVersionsPath, eventVersions } from "@/lib/events";
import { EventVersionRow } from "@/components/event/EventVersionRow";
import { Button } from "@/components/ui/Button";
import { PageError, PageLoading, PageShell } from "@/components/ui/PageShell";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";

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
  const { data: geo, error } = useApiResource<EventDetail>(
    eventId ? `/events/${eventId}` : null
  );

  const buildPath = useCallback(
    (cursor: string | null) => eventVersionsPath(eventId, cursor),
    [eventId]
  );
  const {
    items: rows,
    error: historyError,
    loading,
    loadingMore,
    hasMore,
    loadMore,
  } = useCursorList<EventVersion, EventVersionList>(buildPath, versionRows);

  if (error) return <PageError message={error} />;
  if (!geo) return <PageLoading />;

  const versions = eventVersions(geo, rows, hasMore);

  return (
    // Plain-text title: the *Current* row already links to the event.
    <PageShell back title="Version history" subtitle={geo.title}>
      {historyError && <div className={FORM_ERROR_BANNER}>{historyError}</div>}

      {loading ? (
        <p className="text-sm text-neutral-500">Loading versions…</p>
      ) : (
        <>
          <p className="text-[11px] text-neutral-500">
            <span className="text-neutral-300 font-medium">
              {geo.version_no} version{geo.version_no === 1 ? "" : "s"}
            </span>{" "}
            · newest first
          </p>
          <div className="space-y-2">
            {versions.map((version) => (
              <EventVersionRow key={version.number} eventId={geo.id} version={version} />
            ))}
          </div>
          {hasMore && (
            <div className="flex justify-center">
              <Button variant="secondary" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </>
      )}
    </PageShell>
  );
}
