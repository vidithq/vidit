"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { Megaphone } from "lucide-react";
import { useApiResource } from "@/hooks/useApiResource";
import { useCursorList } from "@/hooks/useCursorList";
import { LoadMoreRow } from "@/components/ui/LoadMoreRow";
import { eventListPath, type EventListSort } from "@/lib/events";
import { formatOpenAge } from "@/lib/format";
import type { Conflict, EventListItem, Tag } from "@/types";
import {
  EMPTY_DATE_WINDOWS,
  EMPTY_EVENT_FILTERS,
  EventFilterSections,
  buildActiveFilterPills,
  countActiveFilters,
  hasCoordsFilter,
  type EventFilterPatch,
  type EventFilterSectionName,
  type EventFilterValues,
} from "@/components/filters/EventFilterSections";
import { FilterBar } from "@/components/filters/FilterBar";
import { PageWithRail } from "@/components/ui/PageWithRail";
import { EntityCard } from "@/components/ui/EntityCard";
import { StatusBadge } from "@/components/event/StatusBadge";
import { PageShell } from "@/components/ui/PageShell";
import { EmptyState } from "@/components/ui/EmptyState";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { TEXT_LINK } from "@/components/ui/styles";
import { buttonClasses } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

// Status is fixed to `requested`, so the board offers no Status section: "closed" would read as
// "done" on a work queue. `GET /events` takes no `media` filter, so Source media stays off too.
const BOARD_SECTIONS: ReadonlyArray<EventFilterSectionName> = [
  "conflict",
  "capture_source",
  "location_guess",
  "tags",
  "author",
];

const SORT_OPTIONS: { value: EventListSort; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
];

export default function RequestsPage() {
  // Public read; "Post request" routes through /submit, which bounces signed-out visitors to login.
  // Cursor-paged: the endpoint caps a response at 100 rows, so follow the `Link: rel="next"` cursor.
  const [values, setValues] = useState<EventFilterValues>(EMPTY_EVENT_FILTERS);
  const [sort, setSort] = useState<EventListSort>("newest");

  const { data: tagsData } = useApiResource<Tag[]>("/tags");
  const { data: conflictsData } = useApiResource<Conflict[]>("/conflicts?used=true");

  const onPatch: EventFilterPatch = (patch) => setValues((v) => ({ ...v, ...patch }));
  const clearFilters = () => setValues(EMPTY_EVENT_FILTERS);
  const activeCount = countActiveFilters(values, EMPTY_DATE_WINDOWS);
  const renderPanel = (
    panelValues: EventFilterValues,
    setPanelValues: (next: EventFilterValues) => void
  ) => (
    <EventFilterSections
      tags={tagsData ?? []}
      conflicts={conflictsData ?? []}
      values={panelValues}
      onPatch={(patch) => setPanelValues({ ...panelValues, ...patch })}
      sections={BOARD_SECTIONS}
    />
  );

  const buildPath = useCallback(
    (cursor: string | null) =>
      eventListPath({
        view: "requested",
        status: "requested",
        conflict: values.conflicts,
        captureSource: values.captureSources,
        tag: values.tags,
        author: values.author.trim() || undefined,
        hasCoords: hasCoordsFilter(values.locationGuess),
        sort,
        cursor,
      }),
    [values, sort]
  );
  const walk = useCursorList<EventListItem>(buildPath);
  const { items: requests, error, loading, hasMore } = walk;

  return (
    <PageShell
      title="Requests"
      controls={
        <>
          <SegmentedControl
            aria-label="Sort requests"
            options={SORT_OPTIONS}
            value={sort}
            onChange={setSort}
          />
          <Link
            href="/submit"
            className={buttonClasses("primary", { className: "whitespace-nowrap" })}
          >
            <Megaphone size={14} strokeWidth={2} />
            Post request
          </Link>
        </>
      }
    >
      <PageWithRail rail={renderPanel(values, setValues)} railLabel="Filters" narrow="hidden">
        <FilterBar
          value={values}
          empty={EMPTY_EVENT_FILTERS}
          count={activeCount}
          pills={buildActiveFilterPills(values, onPatch)}
          onClearAll={clearFilters}
          onApply={setValues}
          renderPanel={renderPanel}
        />

        {error && requests.length === 0 && (
          <div className={FORM_ERROR_BANNER}>{error}</div>
        )}

        {loading && (
          <p className="text-sm text-neutral-500">Loading requests…</p>
        )}

        {!error && !loading && requests.length === 0 && (
          <EmptyState>
            {activeCount > 0 ? (
              "No open requests match the filters."
            ) : (
              <>
                No open requests yet.{" "}
                <Link href="/submit" className={TEXT_LINK}>
                  Post the first one
                </Link>
                .
              </>
            )}
          </EmptyState>
        )}

        {!loading && requests.length > 0 && (
          <>
            <div className="text-[11px] text-neutral-500">
              <span className="text-neutral-300 font-medium">
                {requests.length} open{hasMore ? " so far" : ""}
              </span>
            </div>
            <div className="space-y-3">
              {requests.map((r) => (
                <EntityCard
                  key={r.id}
                  variant="compact"
                  detailHref={`/requests/${r.id}`}
                  title={r.title}
                  badge={<StatusBadge status={r.status} />}
                  media={r.media ?? undefined}
                  isGraphic={r.is_graphic}
                  author={r.owner}
                  date={r.event_date ?? undefined}
                  age={r.requested_at ? formatOpenAge(r.requested_at) : undefined}
                  coords={r.event_coords}
                  tags={r.tags}
                />
              ))}
            </div>
            <LoadMoreRow walk={walk} />
          </>
        )}
      </PageWithRail>
    </PageShell>
  );
}
