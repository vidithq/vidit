import { screen } from "@testing-library/react";

import { FILTER_GROUPS } from "@/components/filters/model";
import { FILTER_GROUPS_KEY } from "@/components/filters/panelState";

/** A fresh viewer who expanded every group of the filter panel. */
export function openFilterGroups() {
  localStorage.clear();
  localStorage.setItem(FILTER_GROUPS_KEY, JSON.stringify(FILTER_GROUPS.map((g) => g.title)));
}

/** The phone bar's **Filters** button, which opens the sheet; the rail's header shares its name. */
export const sheetButton = () =>
  screen.getAllByRole("button", { name: "Filters" }).find((b) => b.getAttribute("aria-haspopup") === "dialog")!;
