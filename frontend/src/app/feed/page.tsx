"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { Users } from "lucide-react";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { useApiResource } from "@/hooks/useApiResource";
import { useCursorList } from "@/hooks/useCursorList";
import { LoadMoreRow } from "@/components/ui/LoadMoreRow";
import { EntityCard } from "@/components/ui/EntityCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { StatusBadge } from "@/components/event/StatusBadge";
import { PageLoading, PageShell } from "@/components/ui/PageShell";
import { Button, buttonClasses } from "@/components/ui/Button";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { ChipBucket } from "@/components/ui/ChipBucket";
import { chipSummary } from "@/components/ui/FilterSection";
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
import { cardTags } from "@/lib/cardTags";
import { appendEventFilterParams } from "@/lib/search";
import { creditProps } from "@/lib/geolocatorCredit";
import type { PublicProfile } from "@/lib/users";
import type { components, operations } from "@/lib/api-types";
import { useFilterVocabulary } from "@/hooks/useFilterVocabulary";

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

const KIND_OPTIONS: { id: FeedKind; name: FeedKind; label: string }[] = [
  { id: "geolocation", name: "geolocation", label: "Geolocations" },
  { id: "request", name: "request", label: "Requests" },
];
const kindLabel = (kind: FeedKind) =>
  KIND_OPTIONS.find((o) => o.name === kind)?.label ?? kind;

// The predicates `GET /feed` serves besides `kind`.
const FEED_SECTIONS: ReadonlyArray<EventFilterSectionName> = [
  "conflict",
  "capture_source",
  "tags",
  "approval",
];

interface FeedFilters {
  kinds: FeedKind[];
  values: EventFilterValues;
}

const EMPTY_FEED_FILTERS: FeedFilters = { kinds: [], values: EMPTY_EVENT_FILTERS };

function itemHref(item: FeedItem): string {
  return item.status === "requested"
    ? `/requests/${item.id}`
    : `/events/${item.id}`;
}

/** The event date when known, then the date the row entered the feed, named by its kind. */
function itemDates(item: FeedItem): { label: string; date: string }[] {
  const entered = {
    label: item.status === "requested" ? "Requested" : "Published",
    date: item.feed_at,
  };
  return item.event_date
    ? [{ label: "Event", date: item.event_date }, entered]
    : [entered];
}

export default function FeedPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const [scope, setScope] = useState<FeedScope>("following");
  const [filters, setFilters] = useState<FeedFilters>(EMPTY_FEED_FILTERS);
  const { tags, conflicts } = useFilterVocabulary();

  const buildPath = useCallback(
    (cursor: string | null) => {
      const search = new URLSearchParams({ scope });
      filters.kinds.forEach((k) => search.append("kind", k));
      appendEventFilterParams(search, filters.values);
      if (cursor) search.set("cursor", cursor);
      return `/feed?${search}`;
    },
    [scope, filters]
  );
  const walk = useCursorList<FeedItem>(buildPath);
  const { items, error, loading } = walk;

  const activeCount =
    filters.kinds.length + countActiveFilters(filters.values, EMPTY_DATE_WINDOWS);
  const pills = [
    ...filters.kinds.map((k) => ({
      key: `kind:${k}`,
      label: kindLabel(k),
      onRemove: () =>
        setFilters((f) => ({ ...f, kinds: f.kinds.filter((x) => x !== k) })),
    })),
    ...buildActiveFilterPills(filters.values, (patch) =>
      setFilters((f) => ({ ...f, values: { ...f.values, ...patch } }))
    ),
  ];
  const renderPanel = (
    panel: FeedFilters,
    setPanel: (next: FeedFilters) => void
  ) => (
    <EventFilterSections
      tags={tags}
      conflicts={conflicts}
      values={panel.values}
      onPatch={(patch) =>
        setPanel({ ...panel, values: { ...panel.values, ...patch } })
      }
      sections={FEED_SECTIONS}
      leadSections={[
        {
          title: "Kind",
          summary: chipSummary(panel.kinds.map(kindLabel)),
          active: panel.kinds.length > 0,
          children: (
            <ChipBucket
              options={KIND_OPTIONS}
              selected={panel.kinds}
              onToggle={(name) => {
                const kind = name as FeedKind;
                setPanel({
                  ...panel,
                  kinds: panel.kinds.includes(kind)
                    ? panel.kinds.filter((k) => k !== kind)
                    : [...panel.kinds, kind],
                });
              }}
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
    <Button variant="primary" onClick={() => setScope("all")}>
      Show all activity
    </Button>
  );

  let body;
  if (error && items.length === 0) {
    body = <div className={FORM_ERROR_BANNER}>{error}</div>;
  } else if (loading || (emptyFollowing && !profile && !profileError)) {
    body = <p className="text-sm text-neutral-500">Loading feed…</p>;
  } else if (items.length > 0) {
    body = (
      <>
        <div className="space-y-4">
          {items.map((item) => (
            <EntityCard
              key={item.id}
              variant="feed"
              detailHref={itemHref(item)}
              title={item.title}
              badge={<StatusBadge status={item.status} />}
              media={item.media ?? undefined}
              isGraphic={item.is_graphic}
              {...creditProps(item)}
              dates={itemDates(item)}
              coords={item.event_coords}
              tags={cardTags(item)}
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
    body = <EmptyState>Nobody has published a geolocation or opened a request yet.</EmptyState>;
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
              Explore the map
            </Link>
          </>
        }
      >
        Follow analysts to see their geolocations and requests here.
      </EmptyState>
    );
  } else {
    body = (
      <EmptyState
        variant="plain"
        lead="Nothing from analysts you follow yet"
        cta={showAll}
      >
        Their geolocations and open requests appear here as they post them.
      </EmptyState>
    );
  }

  return (
    <PageShell
      title="Feed"
      rail={renderPanel(filters, setFilters)}
      railLabel="Filters"
      narrowRail="hidden"
      controls={
        <SegmentedControl
          options={SCOPES}
          value={scope}
          onChange={setScope}
          aria-label="Feed scope"
        />
      }
    >
      <FilterBar
        value={filters}
        empty={EMPTY_FEED_FILTERS}
        count={activeCount}
        pills={pills}
        onClearAll={() => setFilters(EMPTY_FEED_FILTERS)}
        onApply={setFilters}
        renderPanel={renderPanel}
      />
      {body}
    </PageShell>
  );
}
