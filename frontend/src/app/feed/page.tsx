"use client";

import { Suspense, useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Users } from "lucide-react";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { useApiResource } from "@/hooks/useApiResource";
import { useCursorList } from "@/hooks/useCursorList";
import { LoadMoreRow } from "@/components/ui/LoadMoreRow";
import { Item } from "@/components/ui/Item";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageLoading, PageShell } from "@/components/ui/PageShell";
import { ActionIcon, Button, buttonClasses } from "@/components/ui/Button";
import {
  FilterCard,
  FilterSheetBar,
  type FilterPanelProps,
} from "@/components/filters/FilterPanel";
import { anyActive } from "@/components/filters/model";
import { useFilterSurface } from "@/components/filters/useFilterSurface";
import { useTimelines } from "@/components/filters/useTimelines";
import { FEED_PAGE, feedDatesPath, feedPath } from "@/lib/feed";
import { formatDate } from "@/lib/format";
import { eventItem } from "@/lib/items";
import type { PublicProfile } from "@/lib/users";
import type { components } from "@/lib/api-types";
import { ErrorNotice } from "@/components/ui/ErrorNotice";

type FeedItem = components["schemas"]["FeedItemRead"];

const ENTERED_LABEL: Partial<Record<FeedItem["status"], string>> = {
  requested: "Requested",
  detected: "Detected",
};

/** The date the row entered the feed, named by how it entered. */
function enteredLabel(item: FeedItem): string {
  return `${ENTERED_LABEL[item.status] ?? "Published"} ${formatDate(item.feed_at)}`;
}

export default function FeedPage() {
  // `useSearchParams` opts out of static prerender, so the body sits under Suspense.
  return (
    <Suspense fallback={<PageLoading label="Loading feed…" />}>
      <FeedPageBody />
    </Suspense>
  );
}

function FeedPageBody() {
  const { user, loading: authLoading } = useRequireAuth();
  const query = useSearchParams().toString();
  const { filters, panel: filterPanel } = useFilterSurface("feed", {
    url: { format: FEED_PAGE, query },
  });

  const buildPath = useCallback((cursor: string | null) => feedPath(filters, cursor), [filters]);
  const walk = useCursorList<FeedItem>(buildPath);
  const { items, error, loading } = walk;

  const timelines = useTimelines(user ? feedDatesPath(filters) : null);
  const panel: FilterPanelProps = { ...filterPanel, timelines };
  // Following is the feed's own scope: the follow prompts below answer it, not a filter.
  const narrowed = anyActive("feed", { ...filters, following: false });

  // An unfiltered empty following view splits on the follow count: nobody followed, or nothing
  // posted yet.
  const emptyFollowing =
    filters.following &&
    !narrowed &&
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
    <Button action="activity" variant="primary" onClick={() => panel.onPatch({ following: false })}>
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
  } else if (narrowed) {
    body = <EmptyState>Nothing in the feed matches the filters.</EmptyState>;
  } else if (!filters.following) {
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
      rail={<FilterCard {...panel} />}
      railLabel="Filters"
      narrowRail="hidden"
    >
      <FilterSheetBar {...panel} className="lg:hidden" />
      {body}
    </PageShell>
  );
}
