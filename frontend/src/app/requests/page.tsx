"use client";

import Link from "next/link";
import { Megaphone } from "lucide-react";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { useApiResource } from "@/hooks/useApiResource";
import { eventListPath } from "@/lib/events";
import type { EventListItem } from "@/types";
import { EntityCard } from "@/components/ui/EntityCard";
import { StatusBadge } from "@/components/event/StatusBadge";
import { PageLoading, PageShell } from "@/components/ui/PageShell";
import { EmptyState } from "@/components/ui/EmptyState";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { TEXT_LINK } from "@/components/ui/styles";
import { buttonClasses } from "@/components/ui/Button";

export default function RequestsPage() {
  const { user, loading } = useRequireAuth();

  // The board is the open queue: only ``requested`` events. A fulfilled request
  // becomes a ``geolocated`` event and moves to the map; a withdrawn one goes
  // ``closed`` and drops off here (still reachable by permalink). No status
  // filter: "closed" here would mean "withdrawn", which reads as "done" on a
  // work queue and misleads. Enriching this into a triage board (sort, filters,
  // activity signals) is a v1.0 item, gated on request volume (see next.md).
  const { data: requests, error } = useApiResource<EventListItem[]>(
    user ? eventListPath({ view: "requested", status: "requested" }) : null
  );

  if (loading || !user) {
    return <PageLoading />;
  }

  return (
    <PageShell
      title="Requests"
      subtitle="A queue of events someone has spotted but couldn't geolocate: title, media, source and tags, but no coordinates and no proof yet. Anyone with an account can post one; analysts pick them up, do the geolocation work, and promote the result into a full geolocation."
    >
      <div className="flex justify-end">
        <Link
          href="/submit"
          className={buttonClasses("primary", { className: "whitespace-nowrap" })}
        >
          <Megaphone size={14} strokeWidth={2} />
          Post request
        </Link>
      </div>

      {error && <div className={FORM_ERROR_BANNER}>{error}</div>}

      {!error && requests === null && (
        <p className="text-sm text-neutral-500">Loading requests…</p>
      )}

      {!error && requests !== null && requests.length === 0 && (
        <EmptyState>
          No open requests yet.{" "}
          <Link href="/submit" className={TEXT_LINK}>
            Post the first one
          </Link>
          .
        </EmptyState>
      )}

      {!error && requests !== null && requests.length > 0 && (
        <>
          <div className="flex items-center justify-between text-[11px] text-neutral-500">
            <span>
              <span className="text-neutral-300 font-medium">
                {requests.length} open
              </span>{" "}
              · sorted by newest
            </span>
          </div>
          <div className="space-y-3">
            {requests.map((r) => (
              <EntityCard
                key={r.id}
                variant="compact"
                detailHref={`/requests/${r.id}`}
                title={r.title}
                badge={
                  <StatusBadge
                    status={r.status}
                    beforeClosedStatus={r.before_closed_status}
                  />
                }
                media={r.media ?? undefined}
                author={r.owner}
                date={r.event_date ?? undefined}
                coords={r.event_coords}
                working={r.investigator_count ?? undefined}
                tags={r.tags}
              />
            ))}
          </div>
        </>
      )}
    </PageShell>
  );
}
