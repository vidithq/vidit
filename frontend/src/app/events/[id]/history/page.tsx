"use client";

import { useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import type { EventDetail, EventRevision, EventRevisionList } from "@/types";
import { useApiResource } from "@/hooks/useApiResource";
import { useCursorList } from "@/hooks/useCursorList";
import { eventRevisionsPath, eventVersions } from "@/lib/events";
import { EventVersionRow } from "@/components/event/EventVersionRow";
import { Button } from "@/components/ui/Button";
import { PageError, PageLoading, PageShell } from "@/components/ui/PageShell";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { TEXT_LINK } from "@/components/ui/styles";

/** The history read answers an envelope rather than a bare array, so the walk
 *  is told where its rows are. Module-level: `useCursorList` keys its fetches on
 *  this function's identity. */
const revisionRows = (page: EventRevisionList): EventRevision[] => page.items;

/**
 * Every version of one event, newest first.
 *
 * Public, like the history endpoint and the event itself: a corrected record is
 * only auditable if any reader can walk the corrections. Each row opens the
 * version it names, and the current version opens the canonical
 * `/events/{id}`.
 *
 * The list walks the shared cursor (`Link: rel="next"`) like every other list
 * on the site. A version's authorship is filed on the version it superseded, so
 * the oldest row of an unfinished walk is the authorship of the row above it
 * rather than a row of its own; `eventVersions` holds it back until *Load more*
 * brings the page that completes it.
 */
export default function EventHistoryPage() {
  const params = useParams();
  const eventId = typeof params.id === "string" ? params.id : "";
  const { data: geo, error } = useApiResource<EventDetail>(
    eventId ? `/events/${eventId}` : null
  );

  const buildPath = useCallback(
    (cursor: string | null) => eventRevisionsPath(eventId, cursor),
    [eventId]
  );
  const {
    items: revisions,
    error: historyError,
    loading,
    loadingMore,
    hasMore,
    loadMore,
  } = useCursorList<EventRevision, EventRevisionList>(buildPath, revisionRows);

  if (error) return <PageError message={error} />;
  if (!geo) return <PageLoading />;

  const versions = eventVersions(geo, revisions, hasMore);

  return (
    <PageShell
      back
      title="Version history"
      subtitle={
        <Link href={`/events/${geo.id}`} className={TEXT_LINK}>
          {geo.title}
        </Link>
      }
    >
      {historyError && <div className={FORM_ERROR_BANNER}>{historyError}</div>}

      {loading ? (
        <p className="text-sm text-neutral-500">Loading versions…</p>
      ) : (
        <>
          <p className="text-[11px] text-neutral-500">
            <span className="text-neutral-300 font-medium">
              {geo.revision_no} version{geo.revision_no === 1 ? "" : "s"}
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
