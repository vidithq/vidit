import { useCallback, useState } from "react";

import { errorMessage } from "@/lib/api";

interface MutationOptions<R, A extends unknown[]> {
  onSuccess?: (result: R, ...args: A) => void | Promise<void>;
  /** Map a thrown error to a message; `undefined` falls back to `errorMessage(err, fallback)`.
   *  Use to branch on `ApiError.code` / `.status`. */
  onError?: (err: unknown) => string | undefined;
  fallback?: string;
}

/** The loading/error/try/catch/finally wrapper for mutation handlers. `run` resolves to the
 * result, or `undefined` if `fn` threw. `setError` surfaces a client-side validation message;
 * `reset` clears it. */
export function useMutation<R, A extends unknown[]>(
  fn: (...args: A) => Promise<R>,
  options: MutationOptions<R, A> = {}
) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Not memoized: it's only called from event handlers, and a latest-ref trick would trip
  // React Compiler's `react-hooks/refs`.
  const run = async (...args: A): Promise<R | undefined> => {
    setLoading(true);
    setError(null);
    try {
      const result = await fn(...args);
      await options.onSuccess?.(result, ...args);
      return result;
    } catch (err) {
      setError(options.onError?.(err) ?? errorMessage(err, options.fallback));
      return undefined;
    } finally {
      setLoading(false);
    }
  };

  const reset = useCallback(() => setError(null), []);

  return { run, loading, error, setError, reset };
}
