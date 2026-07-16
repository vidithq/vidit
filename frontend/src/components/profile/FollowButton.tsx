"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { UserPlus, UserCheck, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
import { loginNext } from "@/lib/navigation";
import { Button } from "@/components/ui/Button";

interface FollowButtonProps {
  username: string;
  initialFollowing: boolean;
}

export default function FollowButton({
  username,
  initialFollowing,
}: FollowButtonProps) {
  const [following, setFollowing] = useState(initialFollowing);
  const [loading, setLoading] = useState(false);
  // Surfaced under the button on a failed follow/unfollow — otherwise the
  // button silently re-enables in its old state and the click looks lost.
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const toggleFollow = async () => {
    // Following requires an account; the profile page is public, so the
    // proxy can't intercept. Route through login and land back here.
    if (!user) {
      router.push(loginNext(pathname ?? "/"));
      return;
    }
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
      <Button
        variant={following ? "secondary" : "primary"}
        onClick={toggleFollow}
        disabled={loading}
      >
        {loading ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Icon size={14} />
        )}
        {following ? "Following" : "Follow"}
      </Button>
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
