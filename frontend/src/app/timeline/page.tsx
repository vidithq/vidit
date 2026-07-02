"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { MapPin } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useApiResource } from "@/hooks/useApiResource";
import { EntityCard } from "@/components/ui/EntityCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/geolocation/StatusBadge";
import { PageError, PageLoading, PageShell } from "@/components/ui/PageShell";
import { buttonClasses } from "@/components/ui/Button";
import type { GeolocationStatus, Media } from "@/types";

interface TimelineEntry {
  id: string;
  title: string;
  /** Nullable: a coordless / undated event can surface here. See
   *  ``GeolocationList``. */
  event_date: string | null;
  is_demo: boolean;
  status: GeolocationStatus;
  lat: number | null;
  lng: number | null;
  author: {
    username: string;
  };
  /** The card thumbnail: the geolocation's first media row, or null. */
  media: Media | null;
  tags: { id: string; name: string; category: "conflict" | "free" }[];
}

interface PaginatedTimeline {
  items: TimelineEntry[];
  total: number;
}

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
                detailHref={`/geolocations/${entry.id}`}
                title={entry.title}
                badge={
                  entry.status ? <StatusBadge status={entry.status} /> : undefined
                }
                media={entry.media ?? undefined}
                author={entry.author}
                date={entry.event_date ?? undefined}
                coords={
                  typeof entry.lat === "number" && typeof entry.lng === "number"
                    ? { lat: entry.lat, lng: entry.lng }
                    : null
                }
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
