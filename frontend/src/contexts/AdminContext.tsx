"use client";

import { createContext, useContext, type ReactNode } from "react";

import { useAuth } from "@/contexts/AuthContext";
import { useApiResource } from "@/hooks/useApiResource";
import type { components } from "@/lib/api-types";

interface AdminValue {
  isAdmin: boolean;
  /** True until the probe resolves, so an admin sees no "not allowed" flash. */
  loading: boolean;
}

const AdminContext = createContext<AdminValue>({ isAdmin: false, loading: false });

/** One `/admin/me` probe per signed-in analyst, shared by every reader. Separate from
 *  `AuthContext`: `is_admin` is not on the public `/auth/me` shape, so `UserRead` does not leak
 *  the role. The probe answers every analyst (`is_admin: false` for most), so it logs no refusal;
 *  a failed probe reads as not an admin. */
export function AdminProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const probe = useApiResource<components["schemas"]["AdminMeResponse"]>(user ? "/admin/me" : null);
  return (
    <AdminContext.Provider
      value={{ isAdmin: probe.data?.is_admin === true, loading: authLoading || probe.loading }}
    >
      {children}
    </AdminContext.Provider>
  );
}

export function useAdmin(): AdminValue {
  return useContext(AdminContext);
}
