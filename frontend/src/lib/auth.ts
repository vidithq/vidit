// Auth state lives in HttpOnly cookies set by the backend (`vidit_session`
// = JWT, `vidit_csrf` = CSRF token), sent automatically on
// `credentials: include`. The JWT is never touched from JS; only the CSRF
// token is readable, to echo back via `X-CSRF-Token` on state-changing requests.

const CSRF_COOKIE = "vidit_csrf";
export const CSRF_HEADER = "X-CSRF-Token";

// Minimum password length, mirroring the backend PASSWORD_MIN_LENGTH in
// schemas/auth.py so the client-side guard + `minLength` attrs read from one
// source instead of a scattered literal `8`.
export const PASSWORD_MIN_LENGTH = 8;

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

/**
 * Client-side guard for a password-change form: the password must be at least
 * 8 characters and match its confirmation. Returns the message to show, or
 * `null` when both checks pass. Mirrors the backend length rule so the user sees
 * it before a round-trip. `label` names the field in the message — the
 * change-password form says "New password", the reset-password form "Password".
 */
export function validatePasswordChange(
  password: string,
  confirm: string,
  label = "New password"
): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `${label} must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password !== confirm) {
    return `${label}s don't match.`;
  }
  return null;
}
