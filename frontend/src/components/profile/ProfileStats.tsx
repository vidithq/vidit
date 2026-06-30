import { Calendar, MapPin, UserPlus, Users } from "lucide-react";

import type { PublicProfile } from "@/lib/users";
import { formatDate } from "@/lib/format";
import { StatTile, StatGrid } from "@/components/ui/StatTile";

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
