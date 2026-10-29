
import { Card } from "@/components/ui/Card";
import { SeeAllLink } from "@/components/ui/LoadMoreRow";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { Item } from "@/components/ui/Item";
import { eventItem } from "@/lib/items";
import { profileSearchHref } from "@/lib/search";
import type { PublicProfile } from "@/lib/users";
import type { EventListItem } from "@/types";

/**
 * The analyst's open requests: calls they (or the bot for them) posted that nobody has
 * geolocated. Public, like the requests board. The cards are plain links: the verbs live on the
 * request page each opens (where the bot's reply sends the owner too). The parent renders the
 * block only when there is a row.
 *
 * Built like `RecentSubmissions`: list `<Item>` rows under a `SectionEyebrow`, with one link into
 * the wider set.
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
      {/* Same line-breaking rule as `RecentSubmissions`: the heading block asks for a basis, so a tight
          row drops the link to its own line. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="basis-56 grow min-w-0 space-y-1">
          <SectionEyebrow title="Open requests" margin="none" />
          <p className="text-xs text-neutral-500">
            {profile.username}&apos;s footage waiting to be geolocated, newest
            first.
          </p>
        </div>
        {/* `status=requested` so the expansion states its narrowing rather than inheriting it: it lands as
            a removable chip and the link stays honest whatever the search group serves. Same builder as
            the Insights tiles. */}
        <SeeAllLink
          href={profileSearchHref(profile.username, { status: "requested" })}
          className="shrink-0"
        />
      </div>

      <div className="space-y-2">
        {requests.map((entry) => (
          <Item key={entry.id} variant="list" {...eventItem(entry)} />
        ))}
      </div>
    </Card>
  );
}
