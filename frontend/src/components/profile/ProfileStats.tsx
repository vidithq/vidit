import { Calendar, MapPin, UserPlus, Users } from "lucide-react";

import type { PublicProfile } from "@/lib/users";
import { formatDate } from "@/lib/format";
import { StatTile, StatGrid } from "@/components/ui/StatTile";

/**
 * The always-rendered counts strip under the profile header.
 *
 * `Submitted` counts the analyst's published geolocations, the set the
 * Recent submissions block below serves and the `geolocated` leg of the
 * coverage split, so no two numbers on the page disagree. The label is the
 * action that produces the set: submitting a detection is what makes it a
 * geolocation, and a draft nobody submitted is not a submission. Insights
 * names the same figure `Geolocated` beside its `Detected` and `Closed`
 * tallies, where the status vocabulary is what the card is for; this strip
 * is always present, including for the profiles Insights hides.
 */
export function ProfileStats({ profile }: { profile: PublicProfile }) {
  return (
    <StatGrid>
      <StatTile icon={MapPin} label="Submitted" value={profile.geolocations_count} />
      <StatTile icon={Users} label="Followers" value={profile.followers_count} />
      <StatTile icon={UserPlus} label="Following" value={profile.following_count} />
      <StatTile icon={Calendar} label="Since" value={formatDate(profile.created_at)} small />
    </StatGrid>
  );
}
