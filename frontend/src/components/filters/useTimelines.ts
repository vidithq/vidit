import { useState } from "react";

import type { DateHistogram, DayCount } from "@/types";
import { useApiResource } from "@/hooks/useApiResource";
import type { DateKey } from "./model";

const NO_DAYS: Record<DateKey, ReadonlyArray<DayCount>> = { eventDate: [], added: [] };

/** The timelines a date histogram endpoint serves (`GET /search/dates`, `GET /feed/dates`) for
 *  `path`. The last histogram stays while the next one loads, so a scrub never empties the axis. */
export function useTimelines(path: string | null): Record<DateKey, ReadonlyArray<DayCount>> {
  const { data } = useApiResource<DateHistogram>(path);
  const [kept, setKept] = useState<DateHistogram | null>(null);
  if (data && data !== kept) setKept(data);
  const shown = data ?? kept;
  return shown ? { eventDate: shown.occurred_date, added: shown.submitted } : NO_DAYS;
}
