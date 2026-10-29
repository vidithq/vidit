"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useRouter } from "next/navigation";

import { useFilterVocabulary } from "@/hooks/useFilterVocabulary";
import type { FilterPanelProps } from "./FilterPanel";
import { EMPTY_FILTERS, scopeState, type FilterPatch, type FilterState, type Surface } from "./model";

/** How a page URL holds a page's state, in one vocabulary both ways. */
export interface PageUrl<T> {
  path: string;
  read: (params: URLSearchParams) => T;
  write: (value: T) => URLSearchParams;
  /** Whether a change from one query string to the next is a new history entry. */
  pushes?: (from: string, to: string) => boolean;
}

/** Keeps a page's state and its URL in step, so a shared link, Back and Forward land on the same
 *  view. `query` is the URL's query string and `value` starts as `url.read` of it. A URL that
 *  moves (Back, Forward, a link) goes to `onRead`; a changed `value` replaces the URL, or pushes
 *  it where `url.pushes` says so. The page's own write is not read back as a move. */
export function usePageUrl<T>(
  url: PageUrl<T> | null,
  query: string,
  value: T,
  onRead: (value: T) => void,
): void {
  const router = useRouter();
  const written = useRef(url ? url.write(value).toString() : "");
  // Each effect acts on a change of its own input only, so a render that brings both a new URL
  // and the previous value never writes that value back over the URL.
  const seenQuery = useRef(query);
  const seenValue = useRef(value);
  useEffect(() => {
    if (!url || query === seenQuery.current) return;
    seenQuery.current = query;
    const read = url.read(new URLSearchParams(query));
    const next = url.write(read).toString();
    if (next === written.current) return;
    written.current = next;
    onRead(read);
  }, [url, query, onRead]);
  useEffect(() => {
    if (!url || value === seenValue.current) return;
    seenValue.current = value;
    const next = url.write(value).toString();
    if (next === written.current) return;
    const push = url.pushes?.(written.current, next) ?? false;
    written.current = next;
    const href = next ? `${url.path}?${next}` : url.path;
    if (push) router.push(href, { scroll: false });
    else router.replace(href, { scroll: false });
  }, [url, value, router]);
}

export type FilterStore = [FilterState, Dispatch<SetStateAction<FilterState>>];

/** One surface's filter panel: the state, its patch and its clear, and the vocabulary the pickers
 *  offer. The state lives in `store` where the page keeps it (the map's, across navigation), else
 *  here; with `url` it starts from the page URL and stays in step with it (`usePageUrl`). A patch
 *  drops the values the surface no longer offers (`scopeState`). */
export function useFilterSurface(
  surface: Surface,
  { store, url }: { store?: FilterStore; url?: { format: PageUrl<FilterState>; query: string } } = {},
): {
  filters: FilterState;
  setFilters: Dispatch<SetStateAction<FilterState>>;
  panel: Omit<FilterPanelProps, "timelines" | "playback">;
} {
  const own = useState<FilterState>(() =>
    url ? url.format.read(new URLSearchParams(url.query)) : EMPTY_FILTERS,
  );
  const [filters, setFilters] = store ?? own;
  usePageUrl(url?.format ?? null, url?.query ?? "", filters, setFilters);
  const vocabulary = useFilterVocabulary();
  const onPatch: FilterPatch = useCallback(
    (patch) => setFilters((f) => scopeState(surface, { ...f, ...patch })),
    [surface, setFilters],
  );
  const onClear = useCallback(() => setFilters(EMPTY_FILTERS), [setFilters]);
  return {
    filters,
    setFilters,
    panel: { surface, state: filters, onPatch, onClear, vocabulary },
  };
}
