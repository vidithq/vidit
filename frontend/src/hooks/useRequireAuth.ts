"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

/** Bounce an unauthenticated visitor off a protected page; the mirror of
 * `useRedirectIfAuthenticated`. Keyed on the real `user`. Uses `replace` so the protected page
 * doesn't sit in history behind the login form. */
export function useRequireAuth(to = "/login") {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user) router.replace(to);
  }, [loading, user, to, router]);

  return { user, loading };
}
