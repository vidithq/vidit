"use client";

import { useState } from "react";
import Link from "next/link";
import { Megaphone } from "lucide-react";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { useApiResource } from "@/hooks/useApiResource";
import { eventListPath } from "@/lib/events";
import type { EventListItem, EventStatus } from "@/types";
import { EntityCard } from "@/components/ui/EntityCard";
import { StatusBadge } from "@/components/event/StatusBadge";
import { PageLoading, PageShell } from "@/components/ui/PageShell";
import { EmptyState } from "@/components/ui/EmptyState";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";

import { TEXT_LINK } from "@/components/ui/styles";
import { buttonClasses } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";

// The requested view exposes only ``requested`` (open) and ``closed``
// (withdrawn); a fulfilled request becomes a ``geolocated`` event and leaves
// this view. Default "requested" so the queue opens on the still-actionable
// entries.
const STATUS_FILTERS: { value: EventStatus | "all"; label: string }[] = [
  { value: "requested", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
];

export default function RequestsPage() {
  const { user, loading } = useRequireAuth();

  const [statusFilter, setStatusFilter] = useState<EventStatus | "all">("requested");
  const { data: requests, error } = useApiResource<EventListItem[]>(
    user
      ? eventListPath({
          view: "requested",
          status: statusFilter === "all" ? undefined : statusFilter,
        })
      : null
  );

  if (loading || !user) {
    return <PageLoading />;
  }

  // "requested" reads awkwardly as a count noun, so the open state shows as
  // "open" in prose; the wire value stays ``requested``.
  const filterWord = statusFilter === "requested" ? "open" : statusFilter;
  const countLabel =
    requests === null
      ? null
      : statusFilter === "all"
        ? `${requests.length} requests`
        : `${requests.length} ${filterWord}`;

  return (
    <PageShell
      title="Requests"
      subtitle="A queue of events someone has spotted but couldn't geolocate: title, media, source and tags, but no coordinates and no proof yet. Anyone with an account can post one; analysts pick them up, do the geolocation work, and promote the result into a full geolocation."
    >
        {/* Filter chips + new-request CTA share one header row; the subtitle
            already explains the feature, so a single button suffices. */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {STATUS_FILTERS.map((opt) => (
              <Pill
                key={opt.value}
                tone={statusFilter === opt.value ? "accent" : "neutral"}
                onClick={() => setStatusFilter(opt.value)}
              >
                {opt.label}
              </Pill>
            ))}
          </div>
          <Link
            href="/submit"
            className={buttonClasses("primary", { className: "whitespace-nowrap" })}
          >
            <Megaphone size={14} strokeWidth={2} />
            Post request
          </Link>
        </div>

        {error && (
          <div className={FORM_ERROR_BANNER}>
            {error}
          </div>
        )}

        {!error && requests === null && (
          <p className="text-sm text-neutral-500">Loading requests…</p>
        )}

        {!error && requests !== null && requests.length === 0 && (
          <EmptyState>
            No {statusFilter === "all" ? "requests" : `${filterWord} requests`} yet.
            {statusFilter === "all" && (
              <>
                {" "}
                <Link
                  href="/submit"
                  className={TEXT_LINK}
                >
                  Post the first one
                </Link>
                .
              </>
            )}
          </EmptyState>
        )}

        {!error && requests !== null && requests.length > 0 && (
          <>
            <div className="flex items-center justify-between text-[11px] text-neutral-500">
              <span>
                <span className="text-neutral-300 font-medium">{countLabel}</span>{" "}
                · sorted by newest
              </span>
            </div>
            <div className="space-y-3">
              {requests.map((b) => (
                <EntityCard
                  key={b.id}
                  variant="compact"
                  detailHref={`/requests/${b.id}`}
                  title={b.title}
                  badge={
                    <StatusBadge
                      status={b.status}
                      beforeClosedStatus={b.before_closed_status}
                    />
                  }
                  media={b.media ?? undefined}
                  author={b.owner}
                  date={b.event_date ?? undefined}
                  coords={b.event_coords}
                  working={b.investigator_count ?? undefined}
                  tags={b.tags}
                />
              ))}
            </div>
          </>
        )}
    </PageShell>
  );
}