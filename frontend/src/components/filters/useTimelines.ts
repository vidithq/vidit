import { useState } from "react";

import type { DateHistogram, DayCount } from "@/types";
import { useApiResource } from "@/hooks/useApiResource";
import type { DateKey } from "./model";

const NO_DAYS: Record<DateKey, ReadonlyArray<DayCount>> = { eventDate: [], added: [] };

/** The timelines and the row count a date histogram endpoint serves (`GET /search/dates`,
 *  `GET /feed/dates`) for `path`. The last histogram stays while the next one loads, so a scrub
 *  never empties the axis and the count never blanks. */
export function useTimelines(path: string | null): {
  timelines: Record<DateKey, ReadonlyArray<DayCount>>;
  total: number | undefined;
  loading: boolean;
} {
  const { data, loading } = useApiResource<DateHistogram>(path);
  const [kept, setKept] = useState<DateHistogram | null>(null);
  if (data && data !== kept) setKept(data);
  const shown = data ?? kept;
  return {
    timelines: shown ? { eventDate: shown.occurred_date, added: shown.submitted } : NO_DAYS,
    total: shown?.total,
    loading,
  };
}
