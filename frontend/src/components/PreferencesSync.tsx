"use client";

import { useEffect } from "react";

import { useAuth } from "@/contexts/AuthContext";
import { pullDisplay } from "@/lib/preferences";

/** After sign-in, and on each load with a session, the server's display preferences replace
 *  the local cache. A failed pull keeps the cache. Mounted once via `Providers`; renders nothing. */
export default function PreferencesSync() {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    pullDisplay(controller.signal).catch(() => {});
    return () => controller.abort();
  }, [userId]);

  return null;
}
