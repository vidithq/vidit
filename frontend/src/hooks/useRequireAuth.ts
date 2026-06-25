"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Bounce an unauthenticated visitor off a protected page to `to` (default
 * `/login`). The mirror of `useRedirectIfAuthenticated`: returns live auth
 * state so the caller can render `null` (or a skeleton) while the redirect is
 * in flight instead of flashing protected content.
 *
 * Keyed on the real `user` (from `/auth/me`), not the session cookie: once
 * `/auth/me` 401s, `user` is null and the bounce fires. Uses `replace` (not
 * `push`) so the protected page doesn't sit in history behind the login form.
 */
export function useRequireAuth(to = "/login") {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user) router.replace(to);
  }, [loading, user, to, router]);

  return { user, loading };
}
