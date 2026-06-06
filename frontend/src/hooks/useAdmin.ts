"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Probe `/admin/me` once per signed-in session to learn whether the
 * current user is an admin. Lives separate from `AuthContext` on purpose:
 * `is_admin` is not on the public `/auth/me` shape — it's only exposed via
 * the admin-only probe so the public OpenAPI / `UserRead` schema doesn't
 * leak the role.
 *
 * Returns `loading: true` until the probe resolves; the sidebar and the
 * page guard both wait on `loading` before deciding what to render, so
 * an admin doesn't see a "not allowed" flash before the probe lands.
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
        // 401/403/anything else → not an admin. The page guard treats this
        // as a 404 (sword icon hidden, /admin renders not-found).
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
