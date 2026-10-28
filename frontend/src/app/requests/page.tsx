"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { useCursorList } from "@/hooks/useCursorList";
import { LoadMoreRow } from "@/components/ui/LoadMoreRow";
import { eventListPath, type EventListSort } from "@/lib/events";
import { formatOpenAge } from "@/lib/format";
import type { EventListItem } from "@/types";
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
import { FilterRail } from "@/components/filters/FilterRail";
import { EntityCard } from "@/components/ui/EntityCard";
import { StatusBadge } from "@/components/event/StatusBadge";
import { PageShell } from "@/components/ui/PageShell";
import { EmptyState } from "@/components/ui/EmptyState";
import { TEXT_LINK } from "@/components/ui/styles";
import { ActionIcon, buttonClasses } from "@/components/ui/Button";
import { requestHref, submitHref } from "@/lib/routes";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useFilterVocabulary } from "@/hooks/useFilterVocabulary";
import { ErrorNotice } from "@/components/ui/ErrorNotice";

// Status is fixed to `requested`, so the board offers no Status section: "closed" would read as
// "done" on a work queue. `GET /events` takes no `media` filter, so Media stays off too.
const BOARD_SECTIONS: ReadonlyArray<EventFilterSectionName> = [
  "conflict",
  "source_kind",
  "level",
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

  const { tags, conflicts } = useFilterVocabulary();

  const onPatch: EventFilterPatch = (patch) => setValues((v) => ({ ...v, ...patch }));
  const clearFilters = () => setValues(EMPTY_EVENT_FILTERS);
  const activeCount = countActiveFilters(values, EMPTY_DATE_WINDOWS);
  const panel = (
    <EventFilterSections
      tags={tags}
      conflicts={conflicts}
      values={values}
      onPatch={onPatch}
      sections={BOARD_SECTIONS}
    />
  );

  const buildPath = useCallback(
    (cursor: string | null) =>
      eventListPath({
        ...values,
        view: "requested",
        show: ["requested"],
        hasCoords: hasCoordsFilter(values.locationGuess),
        sort,
        cursor,
      }),
    [values, sort]
  );
  const walk = useCursorList<EventListItem>(buildPath);
  const pills = buildActiveFilterPills(values, onPatch);
  const { items: requests, error, loading } = walk;

  return (
    <PageShell
      title="Requests"
      rail={
        <FilterRail pills={pills} onClearAll={clearFilters} sections={BOARD_SECTIONS}>
          {panel}
        </FilterRail>
      }
      railLabel="Filters"
      narrowRail="hidden"
      actions={
        <Link
          href={submitHref("single")}
          className={buttonClasses("primary", { className: "whitespace-nowrap" })}
        >
          <ActionIcon action="request" />
          Post request
        </Link>
      }
      controls={
        <SegmentedControl
          aria-label="Sort requests"
          options={SORT_OPTIONS}
          value={sort}
          onChange={setSort}
        />
      }
    >
      <FilterBar count={activeCount} pills={pills} onClearAll={clearFilters}>
        {panel}
      </FilterBar>

      {error && requests.length === 0 && (
        <ErrorNotice error={error} />
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
              <Link href={submitHref("single")} className={TEXT_LINK}>
                Post the first one
              </Link>
              .
            </>
          )}
        </EmptyState>
      )}

      {!loading && requests.length > 0 && (
        <>
          <div className="space-y-3">
            {requests.map((r) => (
              <EntityCard
                key={r.id}
                variant="compact"
                detailHref={requestHref(r.id)}
                title={r.title}
                badge={<StatusBadge status={r.status} />}
                media={r.media ?? undefined}
                isGraphic={r.is_graphic}
                author={r.owner}
                date={r.occurred_date ?? undefined}
                age={r.requested_at ? formatOpenAge(r.requested_at) : undefined}
                coords={r.coords}
                tags={r.tags}
              />
            ))}
          </div>
          <LoadMoreRow walk={walk} />
        </>
      )}
    </PageShell>
  );
}
