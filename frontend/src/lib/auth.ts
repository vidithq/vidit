// Auth state lives in HttpOnly cookies (`vidit_session` JWT, `vidit_csrf` CSRF token). JS only
// reads the CSRF token, to echo it as `X-CSRF-Token` on state-changing requests.

// Mirrors `auth_cookies.CSRF_COOKIE` + `CSRF_HEADER`; change both. Exported so the e2e suite
// (`e2e/support/mockApi.ts`) sets the same cookie. `proxy.ts` keeps a third, deliberately
// inlined copy (edge runtime).
export const CSRF_COOKIE = "vidit_csrf";
export const CSRF_HEADER = "X-CSRF-Token";

// Mirrors `schemas/auth.PASSWORD_MIN_LENGTH`; change both.
export const PASSWORD_MIN_LENGTH = 8;
// Mirrors `schemas/auth.PASSWORD_MAX_BYTES`; change both. UTF-8 bytes (the bcrypt input limit). As
// `maxLength` it caps UTF-16 units, which never outnumber UTF-8 bytes, so it never blocks a valid one.
export const PASSWORD_MAX_BYTES = 72;

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
 * Client-side new-password guard: at least `PASSWORD_MIN_LENGTH` characters and at most
 * `PASSWORD_MAX_BYTES` UTF-8 bytes. Returns the message, or `null`. `label` names the field.
 */
export function validateNewPassword(password: string, label = "Password"): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `${label} must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) {
    return `${label} must be at most ${PASSWORD_MAX_BYTES} bytes. A plain letter, digit or symbol takes 1 byte; an accented letter or emoji takes 2 to 4.`;
  }
  return null;
}

/** `validateNewPassword` plus a match with the confirmation. */
export function validatePasswordChange(
  password: string,
  confirm: string,
  label = "New password"
): string | null {
  const invalid = validateNewPassword(password, label);
  if (invalid) return invalid;
  if (password !== confirm) {
    return `${label}s don't match.`;
  }
  return null;
}
