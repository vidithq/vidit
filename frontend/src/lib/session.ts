/** The one link between the request path and the auth state. `apiFetch` reports a 401 on a call
 *  that needed the session; `AuthProvider` listens and checks whether the session still holds.
 *  Its own module so a test that mocks `@/lib/api` keeps the link. */
let listener: (() => void) | null = null;

/** Registers the one listener. Returns the unregister. */
export function onSessionRejected(fn: () => void): () => void {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}

export function reportSessionRejected(): void {
  listener?.();
}
