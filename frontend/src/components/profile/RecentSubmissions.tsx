import Link from "next/link";

import { StatusBadge } from "@/components/geolocation/StatusBadge";
import { Card } from "@/components/ui/Card";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { EntityCard } from "@/components/ui/EntityCard";
import { TEXT_LINK } from "@/components/ui/styles";
import type { PublicProfile } from "@/lib/users";
import type { GeolocationStatus } from "@/types";

export interface RecentSubmission {
  id: string;
  title: string;
  event_date: string;
  is_demo: boolean;
  status: GeolocationStatus;
  lat: number;
  lng: number;
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
              titleText={entry.title}
              badge={entry.status ? <StatusBadge status={entry.status} /> : undefined}
              mediaSeed={`sub-${entry.id}`}
              date={entry.event_date}
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
        <div className="py-4 text-center space-y-3">
          <p className="text-sm text-neutral-400">
            No geolocations submitted yet.
          </p>
          <Link
            href="/submit"
            className={`inline-block text-xs ${TEXT_LINK}`}
          >
            Submit your first geolocation →
          </Link>
        </div>
      ) : (
        <p className="text-xs text-neutral-500 italic">Nothing yet.</p>
      )}
    </Card>
  );
}
