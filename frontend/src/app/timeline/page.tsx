"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { MapPin } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useApiResource } from "@/hooks/useApiResource";
import { EntityCard } from "@/components/ui/EntityCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/event/StatusBadge";
import { PageError, PageLoading, PageShell } from "@/components/ui/PageShell";
import { buttonClasses } from "@/components/ui/Button";
import type { components } from "@/lib/api-types";

/** Shape of `GET /timeline`: the same paginated-events envelope `RecentSubmissions`
 *  reads, one `EventListItem` per card. */
type PaginatedTimeline = components["schemas"]["PaginatedEvents"];

export default function TimelinePage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { data, error, loading } = useApiResource<PaginatedTimeline>(
    user ? "/timeline" : null
  );
  const entries = data?.items ?? [];

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [authLoading, user, router]);

  if (authLoading || loading) {
    return <PageLoading label="Loading timeline..." />;
  }

  if (!user) return null;

  if (error) {
    return (
      <PageError message={error} />
    );
  }

  return (
    <PageShell
      title="Timeline"
      subtitle="Activity from analysts you follow, newest geolocations first."
    >
        {entries.length > 0 ? (
          <div className="space-y-4">
            {entries.map((entry) => (
              <EntityCard
                key={entry.id}
                variant="feed"
                detailHref={`/events/${entry.id}`}
                title={entry.title}
                badge={
                  entry.status ? <StatusBadge status={entry.status} /> : undefined
                }
                media={entry.media ?? undefined}
                author={entry.owner}
                date={entry.event_date ?? undefined}
                coords={entry.event_coords}
                tags={entry.tags}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            variant="invite"
            icon={MapPin}
            lead="Your timeline is empty"
            cta={
              <Link href="/map" className={buttonClasses("primary")}>
                Explore the map
              </Link>
            }
          >
            Follow other analysts to see their latest geolocations here.
          </EmptyState>
        )}
    </PageShell>
  );
}
