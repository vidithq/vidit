// Auth state lives in HTTPOnly cookies set by the backend (`vidit_session` for
// the JWT, `vidit_csrf` for the CSRF token). The browser sends them
// automatically on `credentials: include` requests; we never touch the JWT
// from JS. Only the CSRF token is readable here so we can echo it back via
// the `X-CSRF-Token` header on state-changing requests.

const CSRF_COOKIE = "vidit_csrf";
export const CSRF_HEADER = "X-CSRF-Token";

export function readCsrfToken(): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${CSRF_COOKIE}=`;
  for (const part of document.cookie.split("; ")) {
    if (part.startsWith(prefix)) {
      return decodeURIComponent(part.slice(prefix.length));
    }
  }
  return null;
}

/**
 * Returns true iff the browser appears to hold an active session.
 *
 * The session JWT lives in the HttpOnly `vidit_session` cookie which is
 * not visible to `document.cookie`, so we use `vidit_csrf` as the
 * JS-visible proxy: the backend sets both cookies in lockstep on login
 * (`auth_cookies.issue_session_cookies`) and clears both on logout
 * (`auth_cookies.clear_session_cookies`), so their presence tracks the
 * same boolean. A truthy result means "the backend recently established
 * a session for this browser"; absence means "no point firing /auth/me,
 * the answer is already 401". Used by `AuthContext` to skip the
 * unconditional probe and avoid a red `401 Unauthorized` in the
 * DevTools console on every logged-out page load.
 *
 * Cheap, synchronous DOM read — safe in hot paths like context mount.
 */
export function hasSessionCookie(): boolean {
  if (typeof document === "undefined") return false;
  const prefix = `${CSRF_COOKIE}=`;
  return document.cookie.split("; ").some((part) => part.startsWith(prefix));
}
