import { Calendar, MapPin, UserPlus, Users } from "lucide-react";

import type { PublicProfile } from "@/lib/users";
import { formatDate } from "@/lib/format";

export function ProfileStats({ profile }: { profile: PublicProfile }) {
  return (
    <div className="grid grid-cols-4 gap-3">
      <div className="bg-neutral-900 rounded-lg border border-neutral-700 p-3">
        <div className="flex items-center gap-1.5 text-neutral-500 mb-1">
          <MapPin size={11} />
          <span className="text-[10px] uppercase tracking-wider">Submitted</span>
        </div>
        <span className="text-lg font-medium text-neutral-100">
          {profile.geolocations_count}
        </span>
      </div>
      <div className="bg-neutral-900 rounded-lg border border-neutral-700 p-3">
        <div className="flex items-center gap-1.5 text-neutral-500 mb-1">
          <Users size={11} />
          <span className="text-[10px] uppercase tracking-wider">Followers</span>
        </div>
        <span className="text-lg font-medium text-neutral-100">{profile.followers_count}</span>
      </div>
      <div className="bg-neutral-900 rounded-lg border border-neutral-700 p-3">
        <div className="flex items-center gap-1.5 text-neutral-500 mb-1">
          <UserPlus size={11} />
          <span className="text-[10px] uppercase tracking-wider">Following</span>
        </div>
        <span className="text-lg font-medium text-neutral-100">{profile.following_count}</span>
      </div>
      <div className="bg-neutral-900 rounded-lg border border-neutral-700 p-3">
        <div className="flex items-center gap-1.5 text-neutral-500 mb-1">
          <Calendar size={11} />
          <span className="text-[10px] uppercase tracking-wider">Since</span>
        </div>
        <span className="text-sm font-medium text-neutral-100">
          {formatDate(profile.created_at)}
        </span>
      </div>
    </div>
  );
}
