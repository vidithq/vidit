"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Bounce an already-authenticated visitor off a public auth page
 * (login / register) to the app. Returns the live auth state so the
 * caller can render `null` while the redirect is in flight instead of
 * flashing the form.
 *
 * Keyed on the real `user` (resolved from `/auth/me`), NOT just the
 * session cookie: a stale `vidit_csrf` cookie left by an expired session
 * would otherwise bounce login → /map → 401 → /login in a loop. If
 * `/auth/me` 401s, `user` stays null and the form renders normally.
 */
export function useRedirectIfAuthenticated(to = "/map") {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && user) router.replace(to);
  }, [loading, user, to, router]);

  return { user, loading };
}
