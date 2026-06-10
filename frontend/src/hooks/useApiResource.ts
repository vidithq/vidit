import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

interface FetchResult<T> {
  data: T | null;
  error: string | null;
  // Which path this result answers — a result kept across a path change is
  // stale and must not leak into the new page state.
  path: string | null;
}

/**
 * Declarative GET for page data: fetches `path` on mount and on change,
 * aborts the in-flight request on unmount / path change, and skips while
 * `path` is `null` (auth not resolved, route params not ready). Errors
 * propagate as messages for the caller — 401 handling stays in the proxy,
 * don't redirect from here.
 *
 * `refetch` re-runs the current path. After an error it resets to loading
 * (retry buttons); after a success the stale data stays rendered while the
 * request is in flight (post-mutation refresh). A failed refetch replaces
 * that stale data with the error — the previous body is not kept.
 */
export function useApiResource<T>(path: string | null): {
  data: T | null;
  error: string | null;
  loading: boolean;
  refetch: () => void;
} {
  const [result, setResult] = useState<FetchResult<T>>({
    data: null,
    error: null,
    path: null,
  });
  const [generation, setGeneration] = useState(0);

  const refetch = useCallback(() => {
    setResult((prev) =>
      prev.error === null ? prev : { data: null, error: null, path: null }
    );
    setGeneration((g) => g + 1);
  }, []);

  useEffect(() => {
    if (path === null) return;
    const controller = new AbortController();
    apiFetch<T>(path, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        setResult({ data, error: null, path });
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setResult({
          data: null,
          error: e instanceof Error ? e.message : "Request failed",
          path,
        });
      });
    return () => controller.abort();
  }, [path, generation]);

  const fresh = result.path === path ? result : null;
  return {
    data: fresh ? fresh.data : null,
    error: fresh ? fresh.error : null,
    loading: path !== null && fresh === null,
    refetch,
  };
}
