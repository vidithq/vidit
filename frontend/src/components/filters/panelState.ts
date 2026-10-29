"use client";

import { useClientPreference } from "@/hooks/useClientPreference";
import type { Surface } from "./model";

export const FILTER_GROUPS_KEY = "vidit:filter-groups-open";
const PANEL_KEY = "vidit:filters-open";

/** One JSON value in `localStorage`, read through `useClientPreference`. Storage can be absent or
 *  throw (a private window, blocked site data): the value then lives in memory for the session.
 *  The snapshot keeps one value per stored string, as `useSyncExternalStore` requires. */
function storedValue<T>(key: string, fallback: T, parse: (value: unknown) => T | null) {
  const event = `${key}-changed`;
  let current: { raw: string | null; value: T } = { raw: null, value: fallback };
  const read = (): T => {
    let raw: string | null;
    try {
      raw = localStorage.getItem(key);
    } catch {
      return current.value;
    }
    if (raw === current.raw) return current.value;
    let value = fallback;
    try {
      value = raw === null ? fallback : (parse(JSON.parse(raw)) ?? fallback);
    } catch {
      // An unreadable value reads as no value.
    }
    current = { raw, value };
    return value;
  };
  const write = (value: T) => {
    const raw = JSON.stringify(value);
    current = { raw, value };
    try {
      localStorage.setItem(key, raw);
    } catch {
      // Kept in memory.
    }
    window.dispatchEvent(new Event(event));
  };
  const useValue = () => useClientPreference(read, event, () => fallback);
  return { read, write, useValue };
}

const NONE: readonly string[] = [];
const openGroups = storedValue<readonly string[]>(FILTER_GROUPS_KEY, NONE, (value) =>
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

const panelOpen = storedValue<Partial<Record<Surface, boolean>>>(PANEL_KEY, {}, (value) =>
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
