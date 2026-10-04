"use client";

import { useEffect } from "react";
import { notFound, useParams, useRouter } from "next/navigation";

import type { EventDetail, EventVersion } from "@/types";
import { useApiResource } from "@/hooks/useApiResource";
import { eventVersionPath, eventVersion, parseVersionSegment } from "@/lib/events";
import { skipBackRecord } from "@/lib/navigation";
import { EventPageBody } from "@/components/event/EventPageBody";
import { EventVersionBanner } from "@/components/event/EventVersionBanner";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageError, PageLoading, PageShell } from "@/components/ui/PageShell";
import { Pill } from "@/components/ui/Pill";

/**
 * One filed version at `/events/{id}/vN`: the canonical body fed the version's
 * snapshot, read-only, with no action cluster (those act on the record). Three
 * reads: the event, the version, and the version below (it holds the edit's
 * byline and date).
 */
export default function EventVersionPage() {
  const params = useParams();
  const router = useRouter();
  const eventId = typeof params.id === "string" ? params.id : "";
  const number = parseVersionSegment(
    typeof params.version === "string" ? params.version : ""
  );

  const { data: geo, error } = useApiResource<EventDetail>(
    eventId && number !== null ? `/events/${eventId}` : null
  );
  // Only versions below the live row are filed.
  const filed = geo !== null && number !== null && number < geo.version_no;
  const { data: row, error: rowError } = useApiResource<EventVersion>(
    filed ? eventVersionPath(eventId, number!) : null
  );
  const { data: producedBy, error: producedByError } = useApiResource<EventVersion>(
    filed && number! > 1 ? eventVersionPath(eventId, number! - 1) : null
  );

  const isCurrent = geo !== null && number === geo.version_no;
  useEffect(() => {
    if (!isCurrent) return;
    // The current version has one address: forward to it, declaring this page out of the back-stack first.
    skipBackRecord();
    router.replace(`/events/${eventId}`);
  }, [isCurrent, router, eventId]);

  if (number === null) notFound();
  if (error) return <PageError message={error} />;
  if (!geo) return <PageLoading />;
  if (number > geo.version_no) notFound();
  if (isCurrent) return <PageLoading />;
  if (rowError) return <PageError message={rowError} />;
  if (!row) return <PageLoading />;
  // The byline read lands last; if it fails the banner loses its byline, not the page its content.
  if (number > 1 && !producedBy && !producedByError) return <PageLoading />;

  const version = eventVersion(geo, number, { own: row, producedBy });

  return (
    <PageShell
      back
      title={version.view?.title ?? geo.title}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <AuthorByline author={geo.owner} avatar />
          <Pill tone="neutral" title={`Version ${number}`}>
            v{number}
          </Pill>
        </span>
      }
    >
      <EventVersionBanner eventId={geo.id} version={version} total={geo.version_no} />
      {version.view ? (
        <EventPageBody geo={version.view} />
      ) : (
        <EmptyState>
          An administrator redacted this version, so its content is no longer
          served. The version keeps its number and its place in the history.
        </EmptyState>
      )}
    </PageShell>
  );
}
