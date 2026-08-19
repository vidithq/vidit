import { useCallback, useEffect, useRef, useState } from "react";
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

/** The rows out of a page payload that *is* the rows. The default for every
 *  list endpoint answering a bare array; an endpoint answering an envelope
 *  (`GET /events/{id}/versions` serves `{items, total}`) passes its own reader.
 *  Module-level so the default keeps one identity across renders: it is a hook
 *  dependency, and a fresh closure per render would refetch the first page
 *  forever. */
const bareArray = (payload: unknown): unknown[] => payload as unknown[];

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
 * returns its path, so each caller keeps its own query builder. The first-page
 * effect keys on the path string, not on the function, so an unmemoized
 * builder costs a new `loadMore` identity each render rather than a refetch;
 * memoizing it (`useCallback`) is still the shape to write.
 *
 * `reload` refetches the first page and drops the walk so far, for a caller
 * whose own writes change the set (minting or revoking an invite code).
 *
 * `rows` reads the page's rows out of its payload, for the endpoints that wrap
 * them (`{items, total}`). It has to keep one identity across renders, so pass
 * a module-level function, never an inline closure.
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
  // The in-flight `loadMore`, so the first-page effect's cleanup can abort it:
  // a page-2 answer belongs to the path that minted its cursor, and once that
  // path is gone (a filter change, an unmount) the rows are unusable.
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
    // The path this page belongs to, captured now: by the time the answer
    // lands the caller may have rebuilt the query, and appending rows from
    // the old filter set onto the new list is how a walk shows two sets at
    // once.
    const walk = firstPath;
    const controller = new AbortController();
    moreRequest.current = controller;
    setLoadingMore(true);
    apiFetchPage<P>(buildPath(cursor), { signal: controller.signal })
      .then((page) => {
        if (controller.signal.aborted) return;
        // Append, never replace: the walk is totally ordered, so a page can
        // neither repeat a row already shown nor skip one.
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
        // Unconditional: at most one `loadMore` is ever in flight (the guard
        // above), so an aborted one still has to clear the flag or the button
        // stays disabled forever.
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
