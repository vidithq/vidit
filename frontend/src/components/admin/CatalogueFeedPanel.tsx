"use client";

import { eventListPath } from "@/lib/events";
import { useApiResource } from "@/hooks/useApiResource";
import type { EventListItem } from "@/types";
import { StatusBadge } from "@/components/event/StatusBadge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { EntityCard } from "@/components/ui/EntityCard";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";

/** How many catalogue rows the panel shows. */
const RECENT_LIMIT = 10;

/**
 * The newest rows of the public catalogue, as an admin-side pulse check.
 *
 * It reads the public list endpoint with no admin scope of its own: the
 * `located` view (pinned here, not left to the server default the on-screen
 * copy would then misdescribe), so machine detections appear and open
 * `requested` calls do not, and nothing withheld from a public read can show
 * up. Refresh re-reads the list after an action taken in the panels below,
 * which otherwise leaves a deleted or withheld row on screen until a reload.
 */
export function CatalogueFeedPanel() {
  const { data, error, loading, refetch } = useApiResource<EventListItem[]>(
    eventListPath({ view: "located", limit: RECENT_LIMIT })
  );
  const rows = data ?? [];

  return (
    <Card as="section">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <SectionEyebrow title="Catalogue feed" margin="none" />
          <p className="text-xs text-neutral-500 mt-0.5">
            The {RECENT_LIMIT} newest rows of the public catalogue, machine
            detections included. Open a row to act on it.
          </p>
        </div>
        <Button variant="secondary" onClick={refetch} className="shrink-0">
          Refresh
        </Button>
      </header>

      {error ? (
        <div className={FORM_ERROR_BANNER}>{error}</div>
      ) : loading ? (
        <div className="text-xs text-neutral-500 py-2">Loading…</div>
      ) : rows.length === 0 ? (
        <EmptyState variant="plain" lead="Nothing in the catalogue yet." />
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
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
