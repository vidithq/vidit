"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
import { loginNext } from "@/lib/navigation";
import { Button } from "@/components/ui/Button";
import { ErrorNotice } from "@/components/ui/ErrorNotice";

interface FollowButtonProps {
  username: string;
  initialFollowing: boolean;
  /** Called with the new state as soon as the click lands, and with the old one if the request fails. */
  onChange?: (following: boolean) => void;
}

export default function FollowButton({
  username,
  initialFollowing,
  onChange,
}: FollowButtonProps) {
  const [following, setFollowing] = useState(initialFollowing);
  const [loading, setLoading] = useState(false);
  // Shown under the button on a failed follow/unfollow, so the click doesn't look lost.
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const toggleFollow = async () => {
    // Following requires an account and the profile page is public, so the proxy can't intercept:
    // route through login and return here.
    if (!user) {
      router.push(loginNext(pathname ?? "/"));
      return;
    }
    setLoading(true);
    setError(null);
    const wasFollowing = following;
    setFollowing(!wasFollowing);
    onChange?.(!wasFollowing);
    try {
      await apiFetch(`/users/${username}/follow`, { method: wasFollowing ? "DELETE" : "POST" });
    } catch (e) {
      console.error("Failed to toggle follow", e);
      setFollowing(wasFollowing);
      onChange?.(wasFollowing);
      setError(wasFollowing ? "Couldn't unfollow, try again" : "Couldn't follow, try again");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <Button
        action={loading ? undefined : following ? "following" : "follow"}
        variant={following ? "secondary" : "primary"}
        onClick={toggleFollow}
        disabled={loading}
      >
        {loading && <Loader2 size={14} className="animate-spin" />}
        {following ? "Following" : "Follow"}
      </Button>
      {error && (
        <ErrorNotice error={error} />
      )}
    </div>
  );
}
