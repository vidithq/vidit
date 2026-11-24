"use client";

import { useAuth } from "@/contexts/AuthContext";

interface AdminValue {
  isAdmin: boolean;
  /** True until the session resolves, so an admin sees no "not allowed" flash. */
  loading: boolean;
}

/** Whether the signed-in analyst is a site admin, read from the `/auth/me` session. */
export function useAdmin(): AdminValue {
  const { user, loading } = useAuth();
  return { isAdmin: user?.is_admin === true, loading };
}
