import { useCallback, useState } from "react";

import { errorMessage } from "@/lib/api";

interface MutationOptions<R, A extends unknown[]> {
  /** Runs after a successful call, with the result and the `run()` args. */
  onSuccess?: (result: R, ...args: A) => void | Promise<void>;
  /**
   * Map a thrown error to the message to show. Return a string to override the
   * default (`errorMessage(err, fallback)`); return `undefined` to fall back.
   * Use to branch on `ApiError.code` / `.status`.
   */
  onError?: (err: unknown) => string | undefined;
  /** Fallback message when the thrown value isn't an `Error`. */
  fallback?: string;
}

/**
 * The `loading` / `error` / `try` / `catch` / `finally` wrapper every mutation
 * handler repeated inline. `run` flips `loading`, clears `error`, calls `fn`,
 * and on throw sets `error` (via `onError`, else `errorMessage`). It resolves to
 * the result, or `undefined` if `fn` threw. `setError` lets a caller surface a
 * client-side validation message without calling `fn`; `reset` clears the error.
 */
export function useMutation<R, A extends unknown[]>(
  fn: (...args: A) => Promise<R>,
  options: MutationOptions<R, A> = {}
) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A plain function, intentionally not memoized: it's only ever invoked from
  // event handlers (never a dependency array), and the latest-ref trick that
  // would let a `useCallback` keep a stable identity trips React Compiler's
  // `react-hooks/refs` (no ref writes during render).
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
