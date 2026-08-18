"use client";

import { useEffect } from "react";
import { notFound, useParams, useRouter } from "next/navigation";

import type { EventDetail, EventRevision } from "@/types";
import { useApiResource } from "@/hooks/useApiResource";
import { eventRevisionPath, eventVersion, parseVersionSegment } from "@/lib/events";
import { skipBackRecord } from "@/lib/navigation";
import { EventPageBody } from "@/components/event/EventPageBody";
import { EventVersionBanner } from "@/components/event/EventVersionBanner";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageError, PageLoading, PageShell } from "@/components/ui/PageShell";
import { Pill } from "@/components/ui/Pill";

/**
 * One filed version of an event, at `/events/{id}/vN`.
 *
 * It renders through the same body the canonical page renders, fed the version's
 * snapshot instead of the live row, so a version cannot drift into a second
 * layout of its own. The banner says which version this is before anything else,
 * and the action cluster is absent: sharing, reporting and editing act on the
 * record, and the record is at `/events/{id}`.
 *
 * Three reads, each only when it is needed: the event (the immutables and the
 * version count), the version itself, and the version below it, which is where
 * the API files the byline and date of the edit that produced this one.
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
  // The live row is the current version, so only the versions below it are
  // filed and readable here.
  const filed = geo !== null && number !== null && number < geo.revision_no;
  const { data: revision, error: revisionError } = useApiResource<EventRevision>(
    filed ? eventRevisionPath(eventId, number!) : null
  );
  const { data: producedBy, error: producedByError } = useApiResource<EventRevision>(
    filed && number! > 1 ? eventRevisionPath(eventId, number! - 1) : null
  );

  const isCurrent = geo !== null && number === geo.revision_no;
  useEffect(() => {
    if (!isCurrent) return;
    // The current version has one address, and this is not it: a `/vN` link
    // that has since become the current version forwards to the canonical page
    // rather than serving the record at two addresses. The page declares itself
    // out of the back-stack first, so the arrow never walks onto a redirect.
    skipBackRecord();
    router.replace(`/events/${eventId}`);
  }, [isCurrent, router, eventId]);

  // A segment that is not `v<number>` names no version of anything.
  if (number === null) notFound();
  if (error) return <PageError message={error} />;
  if (!geo) return <PageLoading />;
  // Past the current version there is nothing to have been filed.
  if (number > geo.revision_no) notFound();
  if (isCurrent) return <PageLoading />;
  if (revisionError) return <PageError message={revisionError} />;
  if (!revision) return <PageLoading />;
  // The byline read is the last one to land; a failed one costs the banner its
  // byline rather than the page its content.
  if (number > 1 && !producedBy && !producedByError) return <PageLoading />;

  const version = eventVersion(geo, number, { own: revision, producedBy });

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
      <EventVersionBanner eventId={geo.id} version={version} total={geo.revision_no} />
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
