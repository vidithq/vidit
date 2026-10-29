import { screen } from "@testing-library/react";

import type { DateHistogram } from "@/types";
import { FILTER_GROUPS } from "@/components/filters/model";
import { FILTER_GROUPS_KEY } from "@/hooks/useFilterPanelState";

/** A fresh viewer who expanded every group of the filter panel. */
export function openFilterGroups() {
  localStorage.clear();
  localStorage.setItem(FILTER_GROUPS_KEY, JSON.stringify(FILTER_GROUPS.map((g) => g.title)));
}

/** The phone bar's **Filters** button, which opens the sheet; the rail's header shares its name. */
export const sheetButton = () =>
  screen.getAllByRole("button", { name: "Filters" }).find((b) => b.getAttribute("aria-haspopup") === "dialog")!;

const histograms = new Map<string, DateHistogram>();

/** A date histogram endpoint's answer for `path` holding `total` rows: one object per path and
 *  total, as `useApiResource` keeps its data between renders. */
export function histogram(path: string, total: number): DateHistogram {
  const key = `${path}#${total}`;
  if (!histograms.has(key)) histograms.set(key, { occurred_date: [], submitted: [], total });
  return histograms.get(key)!;
}
