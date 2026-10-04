import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

interface FetchResult<T> {
  data: T | null;
  error: string | null;
  // Which path this result answers; a result kept across a path change is stale.
  path: string | null;
}

export interface ApiResource<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refetch: () => void;
}

const EMPTY = { data: null, error: null, path: null };

/** Declarative GET for page data: fetches `path` on mount and change, aborts in-flight on
 * unmount or change, skips while `path` is `null`. Errors propagate as messages; 401 handling
 * stays in the proxy.
 *
 * `refetch` re-runs the path: after an error it resets to loading, after a success stale data
 * stays rendered while in flight. A failed refetch replaces stale data with the error. A
 * path going `null` drops the last result. */
export function useApiResource<T>(path: string | null): ApiResource<T> {
  const [result, setResult] = useState<FetchResult<T>>(EMPTY);
  const [generation, setGeneration] = useState(0);

  // Adjusted during render: React's pattern for state that follows a prop.
  const [lastPath, setLastPath] = useState(path);
  if (path !== lastPath) {
    setLastPath(path);
    if (path === null) setResult(EMPTY);
  }

  const refetch = useCallback(() => {
    setResult((prev) => (prev.error === null ? prev : EMPTY));
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
