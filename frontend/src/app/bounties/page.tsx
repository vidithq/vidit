"use client";

import { useState } from "react";
import Link from "next/link";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { useApiResource } from "@/hooks/useApiResource";
import { bountyListPath } from "@/lib/bounties";
import type { BountyListItem, BountyStatus } from "@/types";
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
const STATUS_FILTERS: { value: BountyStatus | "all"; label: string }[] = [
  { value: "requested", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
];

export default function BountiesPage() {
  const { user, loading } = useRequireAuth();

  const [statusFilter, setStatusFilter] = useState<BountyStatus | "all">("requested");
  const { data: bounties, error } = useApiResource<BountyListItem[]>(
    user
      ? bountyListPath(statusFilter === "all" ? {} : { status: statusFilter })
      : null
  );

  if (loading || !user) {
    return <PageLoading />;
  }

  // "requested" reads awkwardly as a count noun, so the open state shows as
  // "open" in prose; the wire value stays ``requested``.
  const filterWord = statusFilter === "requested" ? "open" : statusFilter;
  const countLabel =
    bounties === null
      ? null
      : statusFilter === "all"
        ? `${bounties.length} bounties`
        : `${bounties.length} ${filterWord}`;

  return (
    <PageShell
      title="Bounties"
      subtitle="A queue of events someone has spotted but couldn't geolocate — title, media, source and tags, but no coordinates and no proof yet. Anyone with an account can post one; analysts pick them up, do the geolocation work, and promote the result into a full geolocation."
    >
        {/* Filter chips + new-bounty CTA share one header row; the subtitle
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
            href="/submit?type=bounty"
            className={buttonClasses("primary", { className: "whitespace-nowrap" })}
          >
            Post bounty
          </Link>
        </div>

        {error && (
          <div className={FORM_ERROR_BANNER}>
            {error}
          </div>
        )}

        {!error && bounties === null && (
          <p className="text-sm text-neutral-500">Loading bounties…</p>
        )}

        {!error && bounties !== null && bounties.length === 0 && (
          <EmptyState>
            No {statusFilter === "all" ? "bounties" : `${filterWord} bounties`} yet.
            {statusFilter === "all" && (
              <>
                {" "}
                <Link
                  href="/submit?type=bounty"
                  className={TEXT_LINK}
                >
                  Post the first one
                </Link>
                .
              </>
            )}
          </EmptyState>
        )}

        {!error && bounties !== null && bounties.length > 0 && (
          <>
            <div className="flex items-center justify-between text-[11px] text-neutral-500">
              <span>
                <span className="text-neutral-300 font-medium">{countLabel}</span>{" "}
                · sorted by newest
              </span>
            </div>
            <div className="space-y-3">
              {bounties.map((b) => (
                <EntityCard
                  key={b.id}
                  variant="compact"
                  detailHref={`/bounties/${b.id}`}
                  title={b.title}
                  badge={<StatusBadge status={b.status} />}
                  media={b.media[0]}
                  author={b.author}
                  date={b.created_at}
                  source={{ url: b.source_url, isDemo: b.is_demo }}
                  working={b.claimer_count}
                  tags={b.tags}
                />
              ))}
            </div>
          </>
        )}
    </PageShell>
  );
}