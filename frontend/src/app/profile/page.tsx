"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { PageCenter } from "@/components/ui/PageShell";

/**
 * Redirects to the canonical /profile/[username] for the current user, so
 * every "view profile" link uses one shape whether it's yours or not.
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
