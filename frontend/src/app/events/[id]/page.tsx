"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { History } from "lucide-react";

import type { EventDetail } from "@/types";
import { useApiResource } from "@/hooks/useApiResource";
import { eventHistoryHref } from "@/lib/events";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { EventPageBody } from "@/components/event/EventPageBody";
import { useEventActions } from "@/components/event/useEventActions";
import { buttonClasses } from "@/components/ui/Button";
import { PageError, PageLoading, PageShell } from "@/components/ui/PageShell";
import { Pill } from "@/components/ui/Pill";

export default function EventPage() {
  const params = useParams();
  const eventId = typeof params.id === "string" ? params.id : "";
  const { data: geo, error } = useApiResource<EventDetail>(
    eventId ? `/events/${eventId}` : null
  );
  // A geolocated event is finished work, so it carries no flow action: the
  // cluster is the utilities tier plus, for its author, the edit that files a
  // revision. Called before the early returns, as every hook here must be.
  const { actions, panels } = useEventActions({ event: geo, surface: "event" });

  if (error)
    return (
      <PageError message={error} />
    );
  if (!geo) return <PageLoading />;

  return (
    <PageShell
      back
      title={geo.title}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <AuthorByline author={geo.owner} avatar />
          {/* Which version the page is showing, next to who filed it: an event
              nobody has corrected is version 1 and says nothing. */}
          {geo.revision_no > 1 && (
            <Pill tone="neutral" title={`Version ${geo.revision_no}`}>
              v{geo.revision_no}
            </Pill>
          )}
          {/* The way into the record's history, beside the version it is
              showing. Public like the history itself: a corrected record is
              only auditable if any reader can walk the corrections, so it is
              not the owner's control. A published row is the only one with
              versions to walk, since every other state is edited in place. */}
          {geo.status === "geolocated" && (
            <Link
              href={eventHistoryHref(geo.id)}
              className={buttonClasses("ghost")}
            >
              <History size={14} />
              History
            </Link>
          )}
        </span>
      }
      actions={actions}
    >
        {/* Directly under the header, where the trigger that opened it is. */}
        {panels}

        <EventPageBody geo={geo} />
    </PageShell>
  );
}
