// Auth state lives in HttpOnly cookies set by the backend (`vidit_session`
// = JWT, `vidit_csrf` = CSRF token), sent automatically on
// `credentials: include`. The JWT is never touched from JS; only the CSRF
// token is readable, to echo back via `X-CSRF-Token` on state-changing requests.

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
 * True iff the browser appears to hold an active session.
 *
 * The JWT lives in the HttpOnly `vidit_session` cookie, invisible to
 * `document.cookie`, so `vidit_csrf` is the JS-visible proxy: the backend
 * sets both in lockstep on login and clears both on logout, so their
 * presence tracks the same boolean. Absence means "no point firing
 * /auth/me, the answer is already 401" — `AuthContext` uses this to skip
 * the unconditional probe and avoid a red `401` in the DevTools console on
 * every logged-out page load.
 */
export function hasSessionCookie(): boolean {
  if (typeof document === "undefined") return false;
  const prefix = `${CSRF_COOKIE}=`;
  return document.cookie.split("; ").some((part) => part.startsWith(prefix));
}
