"use client";

import { useState } from "react";
import { UserPlus, UserCheck, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { NEUTRAL_BUTTON, PRIMARY_BUTTON } from "@/components/ui/styles";

interface FollowButtonProps {
  username: string;
  initialFollowing: boolean;
  compact?: boolean;
}

export default function FollowButton({
  username,
  initialFollowing,
  compact = false,
}: FollowButtonProps) {
  const [following, setFollowing] = useState(initialFollowing);
  const [loading, setLoading] = useState(false);
  // Surfaced under the button on a failed follow/unfollow — otherwise the
  // button silently re-enables in its old state and the click looks lost.
  const [error, setError] = useState<string | null>(null);

  const toggleFollow = async () => {
    setLoading(true);
    setError(null);
    const wasFollowing = following;
    try {
      if (wasFollowing) {
        await apiFetch(`/users/${username}/follow`, { method: "DELETE" });
        setFollowing(false);
      } else {
        await apiFetch(`/users/${username}/follow`, { method: "POST" });
        setFollowing(true);
      }
    } catch (e) {
      console.error("Failed to toggle follow", e);
      setError(wasFollowing ? "Couldn't unfollow — try again" : "Couldn't follow — try again");
    } finally {
      setLoading(false);
    }
  };

  const Icon = following ? UserCheck : UserPlus;

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={toggleFollow}
        disabled={loading}
        className={`inline-flex items-center gap-1.5 rounded-md ${
          following
            ? NEUTRAL_BUTTON
            : PRIMARY_BUTTON
        } ${compact ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm font-medium"}`}
      >
        {loading ? (
          <Loader2 size={compact ? 12 : 14} className="animate-spin" />
        ) : (
          <Icon size={compact ? 12 : 14} />
        )}
        {following ? "Following" : "Follow"}
      </button>
      {error && (
        <span
          role="status"
          aria-live="polite"
          className="text-[11px] text-red-400"
        >
          {error}
        </span>
      )}
    </div>
  );
}
