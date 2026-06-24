"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { MapPin } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useApiResource } from "@/hooks/useApiResource";
import GeolocationCard from "@/components/geolocation/GeolocationCard";
import { PageCenter, PageShell } from "@/components/ui/PageShell";
import { PRIMARY_BUTTON } from "@/components/ui/styles";
import type { GeolocationState } from "@/types";

interface TimelineEntry {
  id: string;
  title: string;
  event_date: string;
  is_demo: boolean;
  state: GeolocationState;
  lat: number;
  lng: number;
  author: {
    username: string;
  };
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
    return (
      <PageCenter>
        <span className="text-neutral-500">Loading timeline...</span>
      </PageCenter>
    );
  }

  if (!user) return null;

  if (error) {
    return (
      <PageCenter>
        <span className="text-red-400">{error}</span>
      </PageCenter>
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
              <GeolocationCard
                key={entry.id}
                geo={entry}
                variant="feed"
                mediaSeed={`timeline-${entry.id}`}
              />
            ))}
          </div>
        ) : (
          <div className="bg-neutral-900/50 border border-dashed border-neutral-800 rounded-lg p-12 text-center space-y-3 max-w-md mx-auto">
            <MapPin size={32} className="mx-auto text-neutral-600" />
            <div className="space-y-1">
              <p className="text-sm text-neutral-300">Your timeline is empty</p>
              <p className="text-xs text-neutral-500 max-w-[240px] mx-auto">
                Follow other analysts to see their latest geolocations here.
              </p>
            </div>
            <Link
              href="/map"
              className={`inline-block px-4 py-2 rounded-md text-xs font-medium ${PRIMARY_BUTTON}`}
            >
              Explore the map
            </Link>
          </div>
        )}
    </PageShell>
  );
}
