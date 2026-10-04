// Auth state lives in HttpOnly cookies (`vidit_session` JWT, `vidit_csrf` CSRF token). JS only
// reads the CSRF token, to echo it as `X-CSRF-Token` on state-changing requests.

// Mirrors `auth_cookies.CSRF_COOKIE` + `CSRF_HEADER`; change both. Exported so the e2e suite
// (`e2e/support/mockApi.ts`) sets the same cookie. `proxy.ts` keeps a third, deliberately
// inlined copy (edge runtime).
export const CSRF_COOKIE = "vidit_csrf";
export const CSRF_HEADER = "X-CSRF-Token";

// Mirrors `schemas/auth.PASSWORD_MIN_LENGTH`; change both.
export const PASSWORD_MIN_LENGTH = 8;

export function readCsrfToken(): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${CSRF_COOKIE}=`;
  for (const part of document.cookie.split("; ")) {
    if (part.startsWith(prefix)) {
      const value = part.slice(prefix.length);
      // A malformed percent sequence must not throw during AuthContext boot; fall back to the raw
      // slice (backend tokens are URL-safe, so the echo still matches).
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }
  return null;
}

/**
 * True iff the browser appears to hold a session. The JWT is HttpOnly, so `vidit_csrf` is the
 * JS-visible proxy (set and cleared in lockstep). Lets `AuthContext` skip the `/auth/me`
 * probe and its logged-out 401 in the console.
 */
export function hasSessionCookie(): boolean {
  return readCsrfToken() !== null;
}

/**
 * Client-side password-change guard: at least `PASSWORD_MIN_LENGTH` characters and a match
 * with the confirmation. Returns the message, or `null`. `label` names the field.
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
