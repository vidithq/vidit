import Link from "next/link";

import { StatusBadge } from "@/components/event/StatusBadge";
import { Card } from "@/components/ui/Card";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { EntityCard } from "@/components/ui/EntityCard";
import { buttonClasses } from "@/components/ui/Button";
import { profileSearchHref } from "@/lib/search";
import type { PublicProfile } from "@/lib/users";
import type { EventListItem } from "@/types";

/**
 * The analyst's open requests: the calls they have posted, or the bot has
 * posted for them, that nobody has geolocated yet.
 *
 * Public, like the requests board itself, so a visitor reading a profile sees
 * what that analyst is asking for and can answer it; its owner reaches the edit
 * and the withdrawal from the same cards, which is where the bot's reply sends
 * them. The parent renders the block only when there is a row, so a profile
 * with nothing open stays clean.
 *
 * Built from the same bricks as `RecentSubmissions`, one row above it in the
 * page: the compact `EntityCard` the located catalogue and the requests board
 * use, under a `SectionEyebrow`, with one link into the wider set. A request
 * lives at `/requests/{id}`, not `/events/{id}`, so that is where the cards go.
 */
export function OpenRequests({
  profile,
  requests,
}: {
  profile: PublicProfile;
  requests: EventListItem[];
}) {
  return (
    <Card>
      {/* Same line-breaking rule as `RecentSubmissions`: the heading block asks
          for a basis, so a row too tight for both drops the link to its own
          line. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="basis-56 grow min-w-0 space-y-1">
          <SectionEyebrow title="Open requests" margin="none" />
          <p className="text-xs text-neutral-500">
            {profile.username}&apos;s footage waiting to be geolocated, newest
            first.
          </p>
        </div>
        {/* `status=requested` so the expansion states the narrowing this block
            shows rather than inheriting it: the value lands as a removable chip
            a reader can drop to widen the view deliberately, and the link stays
            honest whatever the search group serves. Same builder as the Insights
            tiles and the submissions link, so the profile has one shape of link
            into search. */}
        <Link
          href={profileSearchHref(profile.username, { status: "requested" })}
          className={buttonClasses("secondary", {
            className: "shrink-0 whitespace-nowrap",
          })}
        >
          Show more
        </Link>
      </div>

      <div className="space-y-2">
        {requests.map((entry) => (
          <EntityCard
            key={entry.id}
            variant="compact"
            author={{ username: profile.username }}
            detailHref={`/requests/${entry.id}`}
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
    </Card>
  );
}
