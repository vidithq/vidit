"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { loginNext } from "@/lib/navigation";

/** Bounce a signed-out visitor off a protected page to sign-in, which returns them to it; the
 * mirror of `useRedirectIfAuthenticated`. Keyed on the real `user`. Uses `replace` so the
 * protected page doesn't sit in history behind the login form. */
export function useRequireAuth() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user) {
      router.replace(loginNext(window.location.pathname + window.location.search));
    }
  }, [loading, user, router]);

  return { user, loading };
}
