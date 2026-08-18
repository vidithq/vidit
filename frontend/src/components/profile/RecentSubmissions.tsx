import Link from "next/link";

import { StatusBadge } from "@/components/event/StatusBadge";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { EntityCard } from "@/components/ui/EntityCard";
import { TEXT_LINK } from "@/components/ui/styles";
import { buttonClasses } from "@/components/ui/Button";
import type { PublicProfile } from "@/lib/users";
import type { components } from "@/lib/api-types";
import type { EventListItem } from "@/types";

/** One card in the profile's recent-submissions list: the same compact card
 *  shape the located catalogue and the requested queue use. The endpoint
 *  serves published work only (``geolocated``), so every row here carries a
 *  location the analyst vouched for. */
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
      {/* Same line-breaking rule as PageShell's header: the heading block asks
          for a basis, so a row too tight for both drops the link to its own
          line instead of squeezing "Show more" into two stacked words. The
          14rem basis matching the one PageShell uses is cosmetic, not a
          contract: either can be retuned on its own without breaking the
          other. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="basis-56 grow min-w-0 space-y-1">
          <SectionEyebrow title="Recent submissions" margin="none" />
          {/* Gated on the rows this block renders, not on
              ``geolocations_count``. The two now count the same set, so they
              agree on the profiles that matter, but only the rows also cover
              a feed read that failed: keying the copy off a count that
              arrived on a different request promises "latest geolocations"
              above an empty list. */}
          <p className="text-xs text-neutral-500">
            {submissions.length > 0
              ? `${profile.username}'s latest geolocations, newest first.`
              : "No geolocations yet."}
          </p>
        </div>
        {submissions.length > 0 && (
          // ``status=geolocated`` so the expansion serves the same body of
          // work the block above does: search's located group otherwise
          // widens to machine detections. The value is in the panel's own
          // vocabulary, so it lands as a removable chip a reader can drop to
          // widen the view deliberately.
          <Link
            href={`/search?type=event&author=${encodeURIComponent(profile.username)}&status=geolocated`}
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
        // Own profile, nothing submitted yet: the freshly-invited analyst gets
        // a next action instead of dead-ending. A visitor gets nothing further,
        // because the heading above already reads "No geolocations yet." and a
        // second sentence saying the same thing is the block printing its empty
        // state twice.
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
