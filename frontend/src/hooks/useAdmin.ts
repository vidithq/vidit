"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Probe `/admin/me` once per signed-in session for admin status. Separate
 * from `AuthContext` on purpose: `is_admin` is not on the public `/auth/me`
 * shape — only the admin-only probe exposes it, so the public OpenAPI /
 * `UserRead` schema doesn't leak the role.
 *
 * Returns `loading: true` until the probe resolves; the sidebar and page
 * guard wait on it so an admin doesn't see a "not allowed" flash first.
 */
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
        // 401/403/anything else → not an admin. The page guard treats it as
        // a 404 (sword icon hidden, /admin renders not-found).
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
