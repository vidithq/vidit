import Link from "next/link";

import GeolocationCard from "@/components/geolocation/GeolocationCard";
import type { PublicProfile } from "@/lib/users";

export interface RecentSubmission {
  id: string;
  title: string;
  event_date: string;
  is_demo: boolean;
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
    <div className="bg-neutral-900 rounded-lg border border-neutral-700 p-5 space-y-4">
      <div className="space-y-1">
        <h2 className="text-sm font-medium text-neutral-300">
          Recent submissions
        </h2>
        <p className="text-xs text-neutral-500">
          {profile.geolocations_count > 0
            ? `${profile.username}'s latest geolocations, newest first.`
            : "No geolocations yet."}
        </p>
      </div>

      {submissions.length > 0 ? (
        <div className="space-y-2">
          {submissions.map((entry) => (
            <GeolocationCard
              key={entry.id}
              geo={entry}
              variant="compact"
              hideAuthor
              mediaSeed={`sub-${entry.id}`}
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
            href="/geolocations/new"
            className="inline-block text-xs text-orange-400 hover:underline"
          >
            Submit your first geolocation →
          </Link>
        </div>
      ) : (
        <p className="text-xs text-neutral-500 italic">Nothing yet.</p>
      )}
    </div>
  );
}
