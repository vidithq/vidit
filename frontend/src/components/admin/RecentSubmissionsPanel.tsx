"use client";

import { eventListPath } from "@/lib/events";
import { useApiResource } from "@/hooks/useApiResource";
import type { EventListItem } from "@/types";
import { StatusBadge } from "@/components/event/StatusBadge";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { EntityCard } from "@/components/ui/EntityCard";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";

/**
 * What the catalogue received most recently, as an admin-side pulse check.
 *
 * It reads the public list endpoint with no admin scope of its own, so the
 * panel shows exactly what a visitor sees on the catalogue: the default
 * `located` view, newest first. Nothing withheld from a public read can appear
 * here, and no admin verb is offered on a row. To act on one, open it.
 */
const RECENT_LIMIT = 10;

export function RecentSubmissionsPanel() {
  const { data, error, loading } = useApiResource<EventListItem[]>(
    eventListPath({ limit: RECENT_LIMIT })
  );
  const submissions = data ?? [];

  return (
    <Card as="section">
      <header>
        <SectionEyebrow title="Recent submissions" margin="none" />
        <p className="text-xs text-neutral-500 mt-0.5">
          The {RECENT_LIMIT} newest rows of the catalogue, newest first. This is
          the public events list, so it carries the same rows a visitor reads.
          Open a row to act on it.
        </p>
      </header>

      {error && <div className={FORM_ERROR_BANNER}>{error}</div>}
      {loading && !error && (
        <div className="text-xs text-neutral-500 py-2">Loading…</div>
      )}

      {!loading && !error && submissions.length === 0 && (
        <EmptyState variant="plain" lead="No submissions yet." />
      )}

      {submissions.length > 0 && (
        <div className="space-y-2">
          {submissions.map((row) => (
            <EntityCard
              key={row.id}
              detailHref={`/events/${row.id}`}
              variant="compact"
              title={row.title}
              author={row.owner}
              badge={<StatusBadge status={row.status} />}
              date={row.event_date ?? undefined}
              tags={row.tags}
              coords={row.event_coords}
              media={row.media ?? undefined}
              isGraphic={row.is_graphic}
            />
          ))}
        </div>
      )}
    </Card>
  );
}
