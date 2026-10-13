"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { EventDetail } from "@/types";

export type PublishedDetection = Pick<EventDetail, "id" | "title">;

interface ReviewPassValue {
  /** The detections published since the queue list last read the pass, oldest first. */
  published: PublishedDetection[];
  record: (event: PublishedDetection) => void;
  clear: () => void;
}

const ReviewPassContext = createContext<ReviewPassValue>({
  published: [],
  record: () => {},
  clear: () => {},
});

/** Client state for a review pass, which walks one URL per detection, so no page holds it. Nothing
 * persists: a reload drops the pass. */
export function ReviewPassProvider({ children }: { children: ReactNode }) {
  const [published, setPublished] = useState<PublishedDetection[]>([]);
  const record = useCallback(
    (event: PublishedDetection) =>
      setPublished((list) => [...list.filter((e) => e.id !== event.id), event]),
    []
  );
  const clear = useCallback(() => setPublished([]), []);
  const value = useMemo(
    () => ({ published, record, clear }),
    [published, record, clear]
  );
  return (
    <ReviewPassContext.Provider value={value}>
      {children}
    </ReviewPassContext.Provider>
  );
}

export function useReviewPass(): ReviewPassValue {
  return useContext(ReviewPassContext);
}
