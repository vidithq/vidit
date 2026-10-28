"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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
  FilterRailPanel,
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
import { feedDatesPath, feedPageParams, feedPath, readFeedPage } from "@/lib/feed";
import { formatDate } from "@/lib/format";
import { eventItem } from "@/lib/items";
import type { PublicProfile } from "@/lib/users";
import type { components } from "@/lib/api-types";
import { useFilterVocabulary } from "@/hooks/useFilterVocabulary";
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
  const router = useRouter();
  const urlQuery = useSearchParams().toString();
  const [filters, setFilters] = useState<FilterState>(() =>
    readFeedPage(new URLSearchParams(urlQuery)),
  );
  const vocabulary = useFilterVocabulary();

  // The URL holds the filters, so a shared link and Back land on the same view. `written` is the
  // query the page last wrote or read, so its own write is not read back as a move.
  const written = useRef(urlQuery);
  useEffect(() => {
    if (urlQuery === written.current) return;
    written.current = urlQuery;
    setFilters(readFeedPage(new URLSearchParams(urlQuery)));
  }, [urlQuery]);
  useEffect(() => {
    const query = feedPageParams(filters).toString();
    if (query === written.current) return;
    written.current = query;
    router.replace(query ? `/feed?${query}` : "/feed", { scroll: false });
  }, [filters, router]);

  const buildPath = useCallback((cursor: string | null) => feedPath(filters, cursor), [filters]);
  const walk = useCursorList<FeedItem>(buildPath);
  const { items, error, loading } = walk;

  const onPatch: FilterPatch = useCallback((patch) => setFilters((f) => ({ ...f, ...patch })), []);
  const timelines = useTimelines(user ? feedDatesPath(filters) : null);
  const panel: FilterPanelProps = {
    surface: "feed",
    state: filters,
    onPatch,
    onClear: () => setFilters(EMPTY_FILTERS),
    vocabulary,
    timelines,
  };
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
    <Button action="activity" variant="primary" onClick={() => onPatch({ following: false })}>
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
      rail={<FilterRailPanel {...panel} />}
      railLabel="Filters"
      narrowRail="hidden"
    >
      <FilterSheetBar {...panel} className="lg:hidden" />
      {body}
    </PageShell>
  );
}
