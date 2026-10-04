"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

/** Bounce an authenticated visitor off a public auth page; returns auth state so the caller
 * can render `null` during the redirect. Keyed on the real `user` from `/auth/me`, not the
 * cookie: a stale `vidit_csrf` would otherwise loop login → /map → 401 → /login. */
export function useRedirectIfAuthenticated(to = "/map") {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && user) router.replace(to);
  }, [loading, user, to, router]);

  return { user, loading };
}
