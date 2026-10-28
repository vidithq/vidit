import { useCallback, useState } from "react";

import { errorMessage } from "@/lib/api";
import { readError } from "@/lib/errors";
import { isSessionRejected } from "@/lib/session";

interface MutationOptions<R, A extends unknown[]> {
  onSuccess?: (result: R, ...args: A) => void | Promise<void>;
  /** Map a thrown error to a message; `undefined` falls back to `errorMessage(err, fallback)`.
   *  Use to branch on `ApiError.code` / `.status`. */
  onError?: (err: unknown) => string | undefined;
  fallback?: string;
  /** The body fields the form shows a refusal under (`<FieldError>`), read from `fieldErrors`.
   *  A refusal that names only these fields leaves `error` null. */
  fields?: readonly string[];
}

const NO_FIELD_ERRORS: Record<string, string> = {};

/** The loading/error/try/catch/finally wrapper for mutation handlers. `run` resolves to the
 * result, or `undefined` if `fn` threw. `setError` surfaces a client-side validation message;
 * `reset` clears it. A 401 that ended the session leaves `error` null: the session notice says it. */
export function useMutation<R, A extends unknown[]>(
  fn: (...args: A) => Promise<R>,
  options: MutationOptions<R, A> = {}
) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState(NO_FIELD_ERRORS);

  // Not memoized: it's only called from event handlers, and a latest-ref trick would trip
  // React Compiler's `react-hooks/refs`.
  const run = async (...args: A): Promise<R | undefined> => {
    setLoading(true);
    setError(null);
    setFieldErrors(NO_FIELD_ERRORS);
    try {
      const result = await fn(...args);
      await options.onSuccess?.(result, ...args);
      return result;
    } catch (err) {
      const refused = readError(err).fields;
      const named = Object.keys(refused);
      const inPlace = named.filter((field) => options.fields?.includes(field));
      setFieldErrors(
        inPlace.length ? Object.fromEntries(inPlace.map((f) => [f, refused[f]])) : NO_FIELD_ERRORS,
      );
      const message =
        inPlace.length > 0 && inPlace.length === named.length
          ? null
          : (options.onError?.(err) ?? errorMessage(err, options.fallback));
      setError(isSessionRejected(err) ? null : message);
      return undefined;
    } finally {
      setLoading(false);
    }
  };

  const reset = useCallback(() => {
    setError(null);
    setFieldErrors(NO_FIELD_ERRORS);
  }, []);

  return { run, loading, error, setError, fieldErrors, reset };
}
