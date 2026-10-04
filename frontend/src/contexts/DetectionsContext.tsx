"use client";

import { createContext, useContext, type ReactNode } from "react";

import { useAuth } from "@/contexts/AuthContext";
import { useApiResource } from "@/hooks/useApiResource";
import {
  detectionsPath,
  type PaginatedEventDetails,
} from "@/lib/events";

interface DetectionsValue {
  /** Count of the signed-in user's `detected` events awaiting submission; 0 when logged out or none. */
  count: number;
  /** Re-fetch after a submit or reject so the sidebar dot and profile entry update. */
  refresh: () => void;
}

const DetectionsContext = createContext<DetectionsValue>({
  count: 0,
  refresh: () => {},
});

/** One shared fetch of "how many detections await me" for the sidebar dot and profile entry;
 * the endpoint is owner-scoped, so it always reflects the signed-in user. */
export function DetectionsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { data, refetch } = useApiResource<PaginatedEventDetails>(
    user ? detectionsPath(1, 1) : null
  );
  return (
    <DetectionsContext.Provider
      value={{ count: data?.total ?? 0, refresh: refetch }}
    >
      {children}
    </DetectionsContext.Provider>
  );
}

export function useDetectionsCount(): DetectionsValue {
  return useContext(DetectionsContext);
}
