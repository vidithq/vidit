import Link from "next/link";

import { StatusBadge } from "@/components/geolocation/StatusBadge";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { EntityCard } from "@/components/ui/EntityCard";
import { TEXT_LINK } from "@/components/ui/styles";
import type { PublicProfile } from "@/lib/users";
import type { GeolocationStatus, Media } from "@/types";

export interface RecentSubmission {
  id: string;
  title: string;
  /** Nullable: a coordless / undated event (a ``requested`` row) can surface
   *  here. See ``GeolocationList``. */
  event_date: string | null;
  is_demo: boolean;
  status: GeolocationStatus;
  lat: number | null;
  lng: number | null;
  /** The card thumbnail: the geolocation's first media row, or null. */
  media: Media | null;
  tags: { id: string; name: string; category: "conflict" | "free" }[];
}

/** Shape returned by `GET /users/{username}/geolocations`. */
export interface PaginatedSubmissions {
  items: RecentSubmission[];
  total: number;
  page: number;
  per_page: number;
}

export function RecentSubmissions({
  profile,
  submissions,
  isOwn,
}: {
  profile: PublicProfile;
  submissions: RecentSubmission[];
  isOwn: boolean;
}) {
  return (
    <Card>
      <div className="space-y-1">
        <SectionEyebrow title="Recent submissions" margin="none" />
        <p className="text-xs text-neutral-500">
          {profile.geolocations_count > 0
            ? `${profile.username}'s latest geolocations, newest first.`
            : "No geolocations yet."}
        </p>
      </div>

      {submissions.length > 0 ? (
        <div className="space-y-2">
          {submissions.map((entry) => (
            <EntityCard
              key={entry.id}
              variant="compact"
              author={{ username: profile.username }}
              detailHref={`/geolocations/${entry.id}`}
              title={entry.title}
              badge={entry.status ? <StatusBadge status={entry.status} /> : undefined}
              media={entry.media ?? undefined}
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
      ) : isOwn ? (
        // Own profile, nothing submitted yet — give the freshly-invited
        // analyst a clear next action instead of dead-ending on an italic
        // sentence.
        <EmptyState
          variant="plain"
          lead="No geolocations submitted yet."
          cta={
            <Link href="/submit" className={`text-xs ${TEXT_LINK}`}>
              Submit your first geolocation →
            </Link>
          }
        />
      ) : (
        <p className="text-xs text-neutral-500 italic">Nothing yet.</p>
      )}
    </Card>
  );
}
