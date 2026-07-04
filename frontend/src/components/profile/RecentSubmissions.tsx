import Link from "next/link";

import { StatusBadge } from "@/components/event/StatusBadge";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { EntityCard } from "@/components/ui/EntityCard";
import { TEXT_LINK } from "@/components/ui/styles";
import type { PublicProfile } from "@/lib/users";
import type { components } from "@/lib/api-types";
import type { EventListItem } from "@/types";

/** One card in the profile's recent-submissions list: the same compact card
 *  shape the located catalogue and the requested (ex-bounty) queue use. A
 *  coordless / undated event (a ``requested`` row) can surface here too. */
export type RecentSubmission = EventListItem;

/** Shape returned by `GET /users/{username}/events`. */
export type PaginatedSubmissions = components["schemas"]["PaginatedEvents"];

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
              detailHref={`/events/${entry.id}`}
              title={entry.title}
              badge={entry.status ? <StatusBadge status={entry.status} /> : undefined}
              media={entry.media ?? undefined}
              date={entry.event_date ?? undefined}
              coords={entry.event_coords}
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
