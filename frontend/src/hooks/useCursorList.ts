import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetchPage } from "@/lib/api";

interface PagedResult<T> {
  items: T[];
  /** Cursor of the next page, `null` once the walk is exhausted. */
  cursor: string | null;
  error: string | null;
  // Which walk this result answers. A path can come back (toggle away and back, or `reload`),
  // so the path alone cannot tell a stale walk from the current one.
  generation: number;
}

/** Rows of a payload that is the rows: the default for bare-array endpoints. Module-level so
 *  it keeps one identity (a hook dependency; a fresh closure would refetch forever). */
const bareArray = (payload: unknown): unknown[] => payload as unknown[];

type Page<P> = { items: P; nextCursor: string | null };
const linkCursor = (page: Page<unknown>): string | null => page.nextCursor;

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
 * `next` picks the next cursor off a page and defaults to the `Link` cursor. An offset-paged
 * endpoint (`{items, total, page, per_page}`, no `Link`) passes one that reads the payload, with a
 * stable identity too.
 *
 * Each new path or `reload` starts a new walk: until its first page lands the hook reports
 * `loading` with no rows and no cursor, and a page fetched for an earlier walk never appends.
 *
 * A failed `loadMore` keeps the rows and the cursor and sets `error`, so callers render the
 * rows beside the message. Calling `loadMore` again retries the same page and clears `error`
 * once it lands.
 */
export function useCursorList<T, P = T[]>(
  buildPath: (cursor: string | null) => string,
  rows: (payload: P) => T[] = bareArray as (payload: P) => T[],
  next: (page: Page<P>) => string | null = linkCursor
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
    generation: -1,
  });
  const [loadingMore, setLoadingMore] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  // The in-flight `loadMore`, aborted by the first-page cleanup: its page belongs to the walk
  // that minted its cursor.
  const moreRequest = useRef<AbortController | null>(null);

  const firstPath = buildPath(null);

  // Adjusted during render, React's pattern for state that follows a prop: a new path or a
  // reload bumps the generation before the first-page effect runs.
  const walkKey = `${reloadToken}:${firstPath}`;
  const [walk, setWalk] = useState({ key: walkKey, generation: 0 });
  if (walk.key !== walkKey) {
    setWalk({ key: walkKey, generation: walk.generation + 1 });
  }
  const generation = walk.generation;

  useEffect(() => {
    const controller = new AbortController();
    apiFetchPage<P>(firstPath, { signal: controller.signal })
      .then((page) => {
        if (controller.signal.aborted) return;
        setResult({
          items: rows(page.items),
          cursor: next(page),
          error: null,
          generation,
        });
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setResult({
          items: [],
          cursor: null,
          error: e instanceof Error ? e.message : "Request failed",
          generation,
        });
      });
    return () => {
      controller.abort();
      moreRequest.current?.abort();
      moreRequest.current = null;
    };
  }, [firstPath, generation, rows, next]);

  const fresh = result.generation === generation ? result : null;
  const cursor = fresh?.cursor ?? null;

  const loadMore = useCallback(() => {
    if (cursor === null || loadingMore) return;
    // Captured now: if a new walk starts before the answer lands, its rows must not append.
    const started = generation;
    const controller = new AbortController();
    moreRequest.current = controller;
    setLoadingMore(true);
    apiFetchPage<P>(buildPath(cursor), { signal: controller.signal })
      .then((page) => {
        if (controller.signal.aborted) return;
        // Append, never replace: the walk is totally ordered.
        setResult((prev) =>
          prev.generation !== started
            ? prev
            : {
                ...prev,
                items: [...prev.items, ...rows(page.items)],
                cursor: next(page),
                // A retry that lands clears the failed page's message.
                error: null,
              }
        );
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setResult((prev) =>
          prev.generation !== started
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
  }, [buildPath, cursor, generation, loadingMore, rows, next]);

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
