"use client";

import { createContext, useContext, type ReactNode } from "react";

import { useAuth } from "@/contexts/AuthContext";
import { useApiResource } from "@/hooks/useApiResource";
import {
  reviewQueuePath,
  type PaginatedGeolocationDetails,
} from "@/lib/geolocations";

interface ReviewQueueValue {
  /** Count of the signed-in user's machine-`detected` geolocations awaiting
   *  review. 0 when logged out or none pending. */
  count: number;
  /** Re-fetch the count — call after a validate / reject so the sidebar dot and
   *  the profile entry update without a full reload. */
  refresh: () => void;
}

const ReviewQueueContext = createContext<ReviewQueueValue>({
  count: 0,
  refresh: () => {},
});

/**
 * One source for "how many detections await my review", fetched once and shared
 * by the sidebar notification dot and the profile entry, refreshed by the review
 * queue after each action. The endpoint is owner-scoped server-side, so the
 * count always reflects the signed-in user regardless of the page being viewed.
 */
export function ReviewQueueProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { data, refetch } = useApiResource<PaginatedGeolocationDetails>(
    user ? reviewQueuePath(1, 1) : null
  );
  return (
    <ReviewQueueContext.Provider
      value={{ count: data?.total ?? 0, refresh: refetch }}
    >
      {children}
    </ReviewQueueContext.Provider>
  );
}

export function useReviewQueue(): ReviewQueueValue {
  return useContext(ReviewQueueContext);
}
