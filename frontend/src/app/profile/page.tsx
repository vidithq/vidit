"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { PageCenter } from "@/components/ui/PageShell";

/**
 * /profile redirects to the canonical /profile/[username] for the current
 * user. This way every "view profile" link in the app uses the same shape
 * (`/profile/<username>`) regardless of whether it's yours or someone else's.
 */
export default function ProfileRedirect() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
    } else {
      router.replace(`/profile/${user.username}`);
    }
  }, [loading, user, router]);

  return (
    <PageCenter>
      <span className="text-neutral-500">Loading...</span>
    </PageCenter>
  );
}
