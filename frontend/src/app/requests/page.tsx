"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { useCursorList } from "@/hooks/useCursorList";
import { LoadMoreRow } from "@/components/ui/LoadMoreRow";
import { eventListPath, type EventListSort } from "@/lib/events";
import { formatOpenAge } from "@/lib/format";
import type { EventListItem } from "@/types";
import {
  FilterCard,
  FilterSheetBar,
  type FilterPanelProps,
} from "@/components/filters/FilterPanel";
import {
  EMPTY_FILTERS,
  anyActive,
  type FilterPatch,
  type FilterState,
} from "@/components/filters/model";
import { useTimelines } from "@/components/filters/useTimelines";
import { searchDatesPath } from "@/lib/search";
import { Item } from "@/components/ui/Item";
import { eventItem } from "@/lib/items";
import { PageShell } from "@/components/ui/PageShell";
import { EmptyState } from "@/components/ui/EmptyState";
import { TEXT_LINK } from "@/components/ui/styles";
import { ActionIcon, buttonClasses } from "@/components/ui/Button";
import { submitHref } from "@/lib/routes";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useFilterVocabulary } from "@/hooks/useFilterVocabulary";
import { ErrorNotice } from "@/components/ui/ErrorNotice";

const SORT_OPTIONS: { value: EventListSort; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
];

export default function RequestsPage() {
  // Public read; "Post request" routes through /submit, which bounces signed-out visitors to login.
  // Cursor-paged: the endpoint caps a response at 100 rows, so follow the `Link: rel="next"` cursor.
  const [values, setValues] = useState<FilterState>(EMPTY_FILTERS);
  const [sort, setSort] = useState<EventListSort>("newest");

  const vocabulary = useFilterVocabulary();
  const onPatch: FilterPatch = useCallback((patch) => setValues((v) => ({ ...v, ...patch })), []);
  // The board lists the open requests, the set search lists for that one status.
  const request = { ...values, show: ["requested"] };
  const timelines = useTimelines(searchDatesPath({ q: "", types: ["event"], ...request }));
  const panel: FilterPanelProps = {
    surface: "requests",
    state: values,
    onPatch,
    onClear: () => setValues(EMPTY_FILTERS),
    vocabulary,
    timelines,
  };
  const filtered = anyActive("requests", values);

  const buildPath = useCallback(
    (cursor: string | null) =>
      eventListPath({
        ...values,
        view: "requested",
        show: ["requested"],
        sort,
        cursor,
      }),
    [values, sort]
  );
  const walk = useCursorList<EventListItem>(buildPath);
  const { items: requests, error, loading } = walk;

  return (
    <PageShell
      title="Requests"
      rail={<FilterCard {...panel} />}
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
      <FilterSheetBar {...panel} className="lg:hidden" />

      {error && requests.length === 0 && (
        <ErrorNotice error={error} />
      )}

      {loading && (
        <p className="text-sm text-neutral-500">Loading requests…</p>
      )}

      {!error && !loading && requests.length === 0 && (
        <EmptyState>
          {filtered ? (
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
              <Item
                key={r.id}
                variant="list"
                {...eventItem(r)}
                extra={[r.requested_at && formatOpenAge(r.requested_at)]}
              />
            ))}
          </div>
          <LoadMoreRow walk={walk} />
        </>
      )}
    </PageShell>
  );
}
