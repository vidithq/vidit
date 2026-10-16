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
import { cardTags } from "@/lib/cardTags";
import { creditProps } from "@/lib/geolocatorCredit";
import type { PublicProfile } from "@/lib/users";
import type { components, operations } from "@/lib/api-types";

type TimelineItem = components["schemas"]["TimelineItemRead"];
type TimelineScope = NonNullable<
  NonNullable<
    operations["get_timeline_api_v1_timeline_get"]["parameters"]["query"]
  >["scope"]
>;

const SCOPES: { value: TimelineScope; label: string }[] = [
  { value: "following", label: "Following" },
  { value: "all", label: "All" },
];

function itemHref(item: TimelineItem): string {
  return item.status === "requested"
    ? `/requests/${item.id}`
    : `/events/${item.id}`;
}

/** The event date when known, then the date the row entered the timeline, named by its kind. */
function itemDates(item: TimelineItem): { label: string; date: string }[] {
  const entered = {
    label: item.status === "requested" ? "Requested" : "Published",
    date: item.timeline_at,
  };
  return item.event_date
    ? [{ label: "Event", date: item.event_date }, entered]
    : [entered];
}

export default function TimelinePage() {
  const { user, loading: authLoading } = useRequireAuth();
  const [scope, setScope] = useState<TimelineScope>("following");
  const buildPath = useCallback(
    (cursor: string | null) => {
      const search = new URLSearchParams({ scope });
      if (cursor) search.set("cursor", cursor);
      return `/timeline?${search}`;
    },
    [scope]
  );
  const walk = useCursorList<TimelineItem>(buildPath);
  const { items, error, loading } = walk;

  // An empty following view splits on the follow count: nobody followed, or nothing posted yet.
  const emptyFollowing =
    scope === "following" && !loading && !error && items.length === 0;
  const { data: profile, error: profileError } = useApiResource<PublicProfile>(
    emptyFollowing && user ? `/users/${user.username}` : null
  );

  if (authLoading || !user) {
    return <PageLoading label="Loading timeline…" />;
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
    body = <p className="text-sm text-neutral-500">Loading timeline…</p>;
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
          <EmptyState variant="plain" lead="You have reached the end of the timeline" />
        )}
      </>
    );
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
      title="Timeline"
      subtitle="Geolocations and requests, newest first."
      actions={
        <SegmentedControl
          options={SCOPES}
          value={scope}
          onChange={setScope}
          aria-label="Timeline scope"
        />
      }
    >
      {body}
    </PageShell>
  );
}
