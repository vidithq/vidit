"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { PageLoading } from "@/components/ui/PageShell";
import { profileHref } from "@/lib/routes";

/** Redirects to the canonical /profile/[username] for the current user. */
export default function ProfileRedirect() {
  const router = useRouter();
  const { user } = useRequireAuth();

  useEffect(() => {
    if (user) router.replace(profileHref(user.username));
  }, [user, router]);

  return <PageLoading />;
}
