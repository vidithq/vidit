"use client";

import { createContext, useContext, type ReactNode } from "react";

import { useAuth } from "@/contexts/AuthContext";
import { useApiResource } from "@/hooks/useApiResource";
import {
  detectionsPath,
  type PaginatedGeolocationDetails,
} from "@/lib/geolocations";

interface DetectionsValue {
  /** Count of the signed-in user's machine-`detected` geolocations awaiting
   *  submission. 0 when logged out or none pending. */
  count: number;
  /** Re-fetch the count, call after a submit / reject so the sidebar dot and
   *  the profile entry update without a full reload. */
  refresh: () => void;
}

const DetectionsContext = createContext<DetectionsValue>({
  count: 0,
  refresh: () => {},
});

/**
 * One source for "how many detections await me", fetched once and shared by the
 * sidebar notification dot and the profile entry, refreshed by the detections
 * page after each action. The endpoint is owner-scoped server-side, so the count
 * always reflects the signed-in user regardless of the page being viewed.
 */
export function DetectionsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { data, refetch } = useApiResource<PaginatedGeolocationDetails>(
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
