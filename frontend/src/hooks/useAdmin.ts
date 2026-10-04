"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

/** Probe `/admin/me` once per signed-in session. Separate from `AuthContext`: `is_admin` is
 * not on the public `/auth/me` shape, so `UserRead` doesn't leak the role. `loading` stays
 * true until the probe resolves so an admin sees no "not allowed" flash. */
export function useAdmin(): { isAdmin: boolean; loading: boolean } {
  const { user, loading: authLoading } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setIsAdmin(false);
      setLoading(false);
      return;
    }
    let cancelled = false;
    apiFetch<{ is_admin: boolean }>("/admin/me")
      .then((res) => {
        if (cancelled) return;
        setIsAdmin(!!res.is_admin);
      })
      .catch(() => {
        if (cancelled) return;
        // Any failure means not an admin: the guard renders not-found.
        setIsAdmin(false);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  return { isAdmin, loading };
}
