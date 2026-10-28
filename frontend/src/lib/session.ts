/** The one link between the request path and the auth state. `apiFetch` reports a 401 on a call
 *  that needed the session; `AuthProvider` listens and checks whether the session still holds.
 *  Its own module so a test that mocks `@/lib/api` keeps the link. */
let listener: (() => boolean) | null = null;

/** Registers the one listener, which answers whether a signed-in session takes the rejection.
 *  Returns the unregister. */
export function onSessionRejected(fn: () => boolean): () => void {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}

/** True when the auth state takes the rejection, so the session notice speaks for it. */
export function reportSessionRejected(): boolean {
  return listener?.() ?? false;
}

/** True for an error `apiFetch` threw on a rejection the auth state took: the session notice
 *  already says the session ended, so a form shows nothing more. Duck-typed, since `ApiError`
 *  lives in `api.ts`, which imports this module. */
export function isSessionRejected(err: unknown): boolean {
  return err instanceof Error && (err as { sessionRejected?: unknown }).sessionRejected === true;
}

const HELD_KEY = "vidit:session-held";

/** Records whether this browser holds a session, so one that ends without a sign-out (its
 *  cookies expired or cleared) is told on the next load. */
export function markSessionHeld(held: boolean): void {
  try {
    if (held) window.localStorage.setItem(HELD_KEY, "1");
    else window.localStorage.removeItem(HELD_KEY);
  } catch {
    // Storage blocked: the session-ended notice is skipped, nothing else reads the record.
  }
}

/** True, once, when this browser held a session the caller found gone. Clears the record, so
 *  one ended session is told once. */
export function takeEndedSession(): boolean {
  try {
    const held = window.localStorage.getItem(HELD_KEY) === "1";
    window.localStorage.removeItem(HELD_KEY);
    return held;
  } catch {
    return false;
  }
}
