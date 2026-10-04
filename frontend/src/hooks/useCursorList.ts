import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetchPage } from "@/lib/api";

interface PagedResult<T> {
  items: T[];
  /** Cursor of the next page, `null` once the walk is exhausted. */
  cursor: string | null;
  error: string | null;
  // Which first-page path this result answers; a stale one must not leak into the new page.
  path: string | null;
}

/** Rows of a payload that is the rows: the default for bare-array endpoints. Module-level so
 *  it keeps one identity (a hook dependency; a fresh closure would refetch forever). */
const bareArray = (payload: unknown): unknown[] => payload as unknown[];

/**
 * Declarative GET for a cursor-paged list: first page on mount and path change, further pages
 * appended on `loadMore`. The counterpart of `useApiResource` for capped lists (max 100 rows):
 * follows the `Link: rel="next"` cursor, and `hasMore` is true while the server says another
 * page exists.
 *
 * `buildPath` takes the cursor to fetch (`null` for the first) so each caller keeps its own
 * query builder. The first-page effect keys on the path string, so an unmemoized builder only
 * changes `loadMore`'s identity; memoize it anyway. `reload` refetches the first page and
 * drops the walk, for callers whose writes change the set. `rows` reads rows out of a wrapped
 * payload (`{items, total}`) and needs a stable identity: pass a module-level function.
 */
export function useCursorList<T, P = T[]>(
  buildPath: (cursor: string | null) => string,
  rows: (payload: P) => T[] = bareArray as (payload: P) => T[]
): {
  items: T[];
  error: string | null;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
} {
  const [result, setResult] = useState<PagedResult<T>>({
    items: [],
    cursor: null,
    error: null,
    path: null,
  });
  const [loadingMore, setLoadingMore] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  // The in-flight `loadMore`, aborted by the first-page cleanup: its page belongs to the path
  // that minted its cursor.
  const moreRequest = useRef<AbortController | null>(null);

  const firstPath = buildPath(null);

  useEffect(() => {
    const controller = new AbortController();
    apiFetchPage<P>(firstPath, { signal: controller.signal })
      .then((page) => {
        if (controller.signal.aborted) return;
        setResult({
          items: rows(page.items),
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
    return () => {
      controller.abort();
      moreRequest.current?.abort();
      moreRequest.current = null;
    };
  }, [firstPath, reloadToken, rows]);

  const fresh = result.path === firstPath ? result : null;
  const cursor = fresh?.cursor ?? null;

  const loadMore = useCallback(() => {
    if (cursor === null || loadingMore) return;
    // Captured now: if the query is rebuilt before the answer lands, rows from the old filters
    // must not append to the new list.
    const walk = firstPath;
    const controller = new AbortController();
    moreRequest.current = controller;
    setLoadingMore(true);
    apiFetchPage<P>(buildPath(cursor), { signal: controller.signal })
      .then((page) => {
        if (controller.signal.aborted) return;
        // Append, never replace: the walk is totally ordered.
        setResult((prev) =>
          prev.path !== walk
            ? prev
            : {
                ...prev,
                items: [...prev.items, ...rows(page.items)],
                cursor: page.nextCursor,
              }
        );
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setResult((prev) =>
          prev.path !== walk
            ? prev
            : {
                ...prev,
                error: e instanceof Error ? e.message : "Request failed",
              }
        );
      })
      .finally(() => {
        if (moreRequest.current === controller) moreRequest.current = null;
        // Unconditional: only one `loadMore` is ever in flight, so an aborted one must still clear
        // the flag.
        setLoadingMore(false);
      });
  }, [buildPath, cursor, firstPath, loadingMore, rows]);

  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  return {
    items: fresh?.items ?? [],
    error: fresh?.error ?? null,
    loading: fresh === null,
    loadingMore,
    hasMore: cursor !== null,
    loadMore,
    reload,
  };
}
