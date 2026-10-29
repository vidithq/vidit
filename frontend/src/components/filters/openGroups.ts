"use client";

import { useClientPreference } from "@/hooks/useClientPreference";

export const FILTER_GROUPS_KEY = "vidit:filter-groups-open";
const EVENT = "vidit:filter-groups-changed";
const NONE: readonly string[] = [];

// `localStorage` can be absent or throw (a private window, blocked site data): the choice then
// lives in memory for the session. The snapshot keeps one array per stored string, as
// `useSyncExternalStore` requires.
let current: { raw: string | null; open: readonly string[] } = { raw: null, open: NONE };

function read(): readonly string[] {
  let raw: string | null;
  try {
    raw = localStorage.getItem(FILTER_GROUPS_KEY);
  } catch {
    return current.open;
  }
  if (raw === current.raw) return current.open;
  let open = NONE;
  try {
    const value: unknown = JSON.parse(raw ?? "[]");
    if (Array.isArray(value)) open = value.filter((t): t is string => typeof t === "string");
  } catch {
    // An unreadable value reads as every group collapsed.
  }
  current = { raw, open };
  return open;
}

function toggle(title: string) {
  const open = read();
  const next = open.includes(title) ? open.filter((t) => t !== title) : [...open, title];
  const raw = JSON.stringify(next);
  current = { raw, open: next };
  try {
    localStorage.setItem(FILTER_GROUPS_KEY, raw);
  } catch {
    // Kept in memory.
  }
  window.dispatchEvent(new Event(EVENT));
}

/** The filter panel's open groups, by title, and the toggle of one. Every group starts collapsed,
 *  and the viewer's choice holds across surfaces and visits. */
export function useOpenGroups(): [readonly string[], (title: string) => void] {
  return [useClientPreference(read, EVENT, () => NONE), toggle];
}
