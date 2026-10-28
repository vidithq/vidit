"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { Users } from "lucide-react";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { useApiResource } from "@/hooks/useApiResource";
import { useCursorList } from "@/hooks/useCursorList";
import { LoadMoreRow } from "@/components/ui/LoadMoreRow";
import { Item } from "@/components/ui/Item";
import { EmptyState } from "@/components/ui/EmptyState";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { PageLoading, PageShell } from "@/components/ui/PageShell";
import { ActionIcon, Button, buttonClasses } from "@/components/ui/Button";
import {
  EMPTY_DATE_WINDOWS,
  EMPTY_EVENT_FILTERS,
  EventFilterSections,
  buildActiveFilterPills,
  countActiveFilters,
  type EventFilterSectionName,
  type EventFilterValues,
} from "@/components/filters/EventFilterSections";
import { FilterBar } from "@/components/filters/FilterBar";
import { FilterRail } from "@/components/filters/FilterRail";
import { appendEventFilterParams } from "@/lib/search";
import { formatDate } from "@/lib/format";
import { eventItem } from "@/lib/items";
import type { PublicProfile } from "@/lib/users";
import type { components, operations } from "@/lib/api-types";
import { useFilterVocabulary } from "@/hooks/useFilterVocabulary";
import { ErrorNotice } from "@/components/ui/ErrorNotice";

type FeedItem = components["schemas"]["FeedItemRead"];
type FeedQuery = NonNullable<
  operations["get_feed_api_v1_feed_get"]["parameters"]["query"]
>;
type FeedScope = NonNullable<FeedQuery["scope"]>;
type FeedKind = NonNullable<FeedQuery["kind"]>[number];

const SCOPES: { value: FeedScope; label: string }[] = [
  { value: "following", label: "Following" },
  { value: "all", label: "All" },
];

// `GET /feed` takes the Show filter as `kind`, one value per status. No status chosen sends no
// `kind`, and the feed then serves all three.
const FEED_KINDS: Record<string, FeedKind> = {
  requested: "request",
  detected: "detected",
  geolocated: "geolocation",
};

// The predicates `GET /feed` serves.
const FEED_SECTIONS: ReadonlyArray<EventFilterSectionName> = [
  "show",
  "conflict",
  "source_kind",
  "level",
  "tags",
  "approval",
];

const ENTERED_LABEL: Partial<Record<FeedItem["status"], string>> = {
  requested: "Requested",
  detected: "Detected",
};

/** The date the row entered the feed, named by how it entered. */
function enteredLabel(item: FeedItem): string {
  return `${ENTERED_LABEL[item.status] ?? "Published"} ${formatDate(item.feed_at)}`;
}

export default function FeedPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const [scope, setScope] = useState<FeedScope>("following");
  const [filters, setFilters] = useState<EventFilterValues>(EMPTY_EVENT_FILTERS);
  const { tags, conflicts } = useFilterVocabulary();

  const buildPath = useCallback(
    (cursor: string | null) => {
      const search = new URLSearchParams({ scope });
      filters.show.forEach((status) => search.append("kind", FEED_KINDS[status]));
      appendEventFilterParams(search, { ...filters, show: [] });
      if (cursor) search.set("cursor", cursor);
      return `/feed?${search}`;
    },
    [scope, filters]
  );
  const walk = useCursorList<FeedItem>(buildPath);
  const { items, error, loading } = walk;

  const activeCount = countActiveFilters(filters, EMPTY_DATE_WINDOWS);
  const onPatch = (patch: Partial<EventFilterValues>) => setFilters((f) => ({ ...f, ...patch }));
  const clearFilters = () => setFilters(EMPTY_EVENT_FILTERS);
  const pills = buildActiveFilterPills(filters, onPatch);
  const panel = (
    <EventFilterSections
      tags={tags}
      conflicts={conflicts}
      values={filters}
      onPatch={onPatch}
      sections={FEED_SECTIONS}
      lead={[
        {
          title: "Activity",
          children: (
            <SegmentedControl
              options={SCOPES}
              value={scope}
              onChange={setScope}
              aria-label="Activity"
              fullWidth
            />
          ),
        },
      ]}
    />
  );

  // An unfiltered empty following view splits on the follow count: nobody followed, or nothing
  // posted yet.
  const emptyFollowing =
    scope === "following" &&
    activeCount === 0 &&
    !loading &&
    !error &&
    items.length === 0;
  const { data: profile, error: profileError } = useApiResource<PublicProfile>(
    emptyFollowing && user ? `/users/${user.username}` : null
  );

  if (authLoading || !user) {
    return <PageLoading label="Loading feed…" />;
  }

  const showAll = (
    <Button action="activity" variant="primary" onClick={() => setScope("all")}>
      Show all activity
    </Button>
  );

  let body;
  if (error && items.length === 0) {
    body = <ErrorNotice error={error} />;
  } else if (loading || (emptyFollowing && !profile && !profileError)) {
    body = <p className="text-sm text-neutral-500">Loading feed…</p>;
  } else if (items.length > 0) {
    body = (
      <>
        <div className="space-y-4">
          {items.map((item) => (
            <Item
              key={item.id}
              variant="card"
              {...eventItem(item)}
              extra={[enteredLabel(item)]}
            />
          ))}
        </div>
        {walk.hasMore ? (
          <LoadMoreRow walk={walk} infinite />
        ) : (
          <EmptyState variant="plain" lead="You have reached the end of the feed" />
        )}
      </>
    );
  } else if (activeCount > 0) {
    body = <EmptyState>Nothing in the feed matches the filters.</EmptyState>;
  } else if (scope === "all") {
    body = <EmptyState>Nobody has published a geolocation, opened a request or imported a detection yet.</EmptyState>;
  } else if (profile?.following_count === 0) {
    body = (
      <EmptyState
        variant="invite"
        icon={Users}
        lead="You follow no analysts yet"
        cta={
          <>
            {showAll}
            <Link href="/map" className={buttonClasses("secondary")}>
              <ActionIcon action="map" />
              Explore the map
            </Link>
          </>
        }
      >
        Follow analysts to see their geolocations, requests and detections here.
      </EmptyState>
    );
  } else {
    body = (
      <EmptyState
        variant="plain"
        lead="Nothing from analysts you follow yet"
        cta={showAll}
      >
        Their geolocations, open requests and detections appear here as they post them.
      </EmptyState>
    );
  }

  return (
    <PageShell
      title="Feed"
      rail={
        <FilterRail pills={pills} onClearAll={clearFilters} sections={FEED_SECTIONS}>
          {panel}
        </FilterRail>
      }
      railLabel="Filters"
      narrowRail="hidden"
    >
      <FilterBar count={activeCount} pills={pills} onClearAll={clearFilters}>
        {panel}
      </FilterBar>
      {body}
    </PageShell>
  );
}
