import Link from "next/link";

import { StatusBadge } from "@/components/event/StatusBadge";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { EntityCard } from "@/components/ui/EntityCard";
import { TEXT_LINK } from "@/components/ui/styles";
import { buttonClasses } from "@/components/ui/Button";
import { profileSearchHref } from "@/lib/search";
import type { PublicProfile } from "@/lib/users";
import type { components } from "@/lib/api-types";
import type { EventListItem } from "@/types";

/** One card in the recent-submissions list, the compact shape the located catalogue and requested
 * queue use. The endpoint serves published work only (`geolocated`). */
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
      {/* Same line-breaking rule as PageShell's header: the heading block asks for a basis, so a tight
          row drops the link to its own line. The 14rem basis is cosmetic, not a contract. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="basis-56 grow min-w-0 space-y-1">
          <SectionEyebrow title="Recent submissions" margin="none" />
          {/* Gated on the rows this block renders, not `geolocations_count`: a count from a different
              request could promise "latest geolocations" above an empty list (a failed feed read). */}
          <p className="text-xs text-neutral-500">
            {submissions.length > 0
              ? `${profile.username}'s latest geolocations, newest first.`
              : "No geolocations yet."}
          </p>
        </div>
        {submissions.length > 0 && (
          // Mirrors backend `event_filters.published_events()`: `status=geolocated` makes the expansion serve the
          // same work as the block above (search's located group otherwise widens to machine detections). In the
          // panel's own vocabulary, so it lands as a removable chip. Same builder as the Insights tiles.
          <Link
            href={profileSearchHref(profile.username, { status: "geolocated" })}
            className={buttonClasses("secondary", {
              className: "shrink-0 whitespace-nowrap",
            })}
          >
            Show more
          </Link>
        )}
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
              isGraphic={entry.is_graphic}
              date={entry.event_date ?? undefined}
              coords={entry.event_coords}
              tags={entry.tags}
            />
          ))}
        </div>
      ) : (
        // Own profile, nothing submitted: the freshly-invited analyst gets a next action. A visitor gets
        // nothing more, since the heading already reads "No geolocations yet."
        isOwn && (
          <EmptyState
            variant="plain"
            lead="No geolocations submitted yet."
            cta={
              <Link href="/submit" className={`text-xs ${TEXT_LINK}`}>
                Submit your first geolocation →
              </Link>
            }
          />
        )
      )}
    </Card>
  );
}
