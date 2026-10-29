"use client";

import type { Surface } from "@/components/filters/model";
import { storedJson } from "./storedJson";

export const FILTER_GROUPS_KEY = "vidit:filter-groups-open";
const PANEL_KEY = "vidit:filters-open";

const NONE: readonly string[] = [];
const openGroups = storedJson<readonly string[]>(FILTER_GROUPS_KEY, NONE, (value) =>
  Array.isArray(value) ? value.filter((t): t is string => typeof t === "string") : null,
);

function toggleGroup(title: string) {
  const open = openGroups.read();
  openGroups.write(open.includes(title) ? open.filter((t) => t !== title) : [...open, title]);
}

/** The filter panel's open groups, by title, and the toggle of one. Every group starts collapsed,
 *  and the viewer's choice holds across surfaces and visits. */
export function useOpenGroups(): [readonly string[], (title: string) => void] {
  return [openGroups.useValue(), toggleGroup];
}

const panelOpen = storedJson<Partial<Record<Surface, boolean>>>(PANEL_KEY, {}, (value) =>
  value && typeof value === "object" ? (value as Partial<Record<Surface, boolean>>) : null,
);

/** The map's panel starts closed, the map leading with the catalogue; a list's rail starts open. */
const OPEN_BY_DEFAULT: Record<Surface, boolean> = {
  map: false,
  search: true,
  feed: true,
  requests: true,
};

/** Whether a surface's filter panel is open under its **Filters** header, and its toggle. The
 *  viewer's choice holds per surface across visits. */
export function usePanelOpen(surface: Surface): [boolean, () => void] {
  const stored = panelOpen.useValue()[surface];
  const open = typeof stored === "boolean" ? stored : OPEN_BY_DEFAULT[surface];
  return [open, () => panelOpen.write({ ...panelOpen.read(), [surface]: !open })];
}
