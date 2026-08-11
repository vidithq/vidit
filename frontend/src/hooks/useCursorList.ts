import { useCallback, useEffect, useState } from "react";
import { apiFetchPage } from "@/lib/api";

interface PagedResult<T> {
  items: T[];
  /** Cursor of the next page, `null` once the walk is exhausted. */
  cursor: string | null;
  error: string | null;
  // Which first-page path this result answers, so a result kept across a path
  // change is recognised as stale instead of leaking into the new page state.
  path: string | null;
}

/**
 * Declarative GET for a cursor-paged list: fetches the first page on mount and
 * on path change, and appends each further page on `loadMore`.
 *
 * The counterpart of `useApiResource` for the capped list endpoints. A list
 * response holds at most 100 rows, so a surface showing more of the set
 * follows the `Link: rel="next"` cursor rather than asking for a wider page:
 * `hasMore` is true exactly while the server says another page exists.
 *
 * `buildPath` takes the cursor of the page to fetch (`null` for the first) and
 * returns its path, so each caller keeps its own query builder. It must be
 * stable across renders (`useCallback`), or the first page refetches on every
 * render.
 */
export function useCursorList<T>(buildPath: (cursor: string | null) => string): {
  items: T[];
  error: string | null;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
} {
  const [result, setResult] = useState<PagedResult<T>>({
    items: [],
    cursor: null,
    error: null,
    path: null,
  });
  const [loadingMore, setLoadingMore] = useState(false);

  const firstPath = buildPath(null);

  useEffect(() => {
    const controller = new AbortController();
    apiFetchPage<T[]>(firstPath, { signal: controller.signal })
      .then((page) => {
        if (controller.signal.aborted) return;
        setResult({
          items: page.items,
          cursor: page.nextCursor,
          error: null,
          path: firstPath,
        });
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setResult({
          items: [],
          cursor: null,
          error: e instanceof Error ? e.message : "Request failed",
          path: firstPath,
        });
      });
    return () => controller.abort();
  }, [firstPath]);

  const fresh = result.path === firstPath ? result : null;
  const cursor = fresh?.cursor ?? null;

  const loadMore = useCallback(() => {
    if (cursor === null || loadingMore) return;
    setLoadingMore(true);
    apiFetchPage<T[]>(buildPath(cursor))
      .then((page) => {
        // Append, never replace: the walk is totally ordered, so a page can
        // neither repeat a row already shown nor skip one.
        setResult((prev) => ({
          ...prev,
          items: [...prev.items, ...page.items],
          cursor: page.nextCursor,
        }));
      })
      .catch((e: unknown) => {
        setResult((prev) => ({
          ...prev,
          error: e instanceof Error ? e.message : "Request failed",
        }));
      })
      .finally(() => setLoadingMore(false));
  }, [buildPath, cursor, loadingMore]);

  return {
    items: fresh?.items ?? [],
    error: fresh?.error ?? null,
    loading: fresh === null,
    loadingMore,
    hasMore: cursor !== null,
    loadMore,
  };
}
