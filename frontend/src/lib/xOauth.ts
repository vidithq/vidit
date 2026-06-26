// "Continue with X" client glue. The OAuth flow itself is browser redirects
// to the backend (/auth/x/start → X consent → /auth/x/callback); this module
// only builds the entry URL, gates the button on the build-time flag, and maps
// the typed `?x_error=` codes the callback redirects back with to human copy.
//
// The button is dark unless NEXT_PUBLIC_X_OAUTH_ENABLED is "true" — mirrors the
// backend `x_oauth_enabled` gate so the UI never offers a 503.

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

export const X_OAUTH_ENABLED = process.env.NEXT_PUBLIC_X_OAUTH_ENABLED === "true";

export const X_OAUTH_START_URL = `${API_URL}/auth/x/start`;

// Codes the callback emits on failure (see backend routers/auth_x.py). A
// no-profile handle is NOT an error — it redirects into register-with-X.
const X_ERROR_MESSAGES: Record<string, string> = {
  oauth_refused: "X sign-in was cancelled.",
  invalid_state: "X sign-in didn't complete. Please try again.",
  x_oauth_failed: "X sign-in didn't complete. Please try again.",
  x_handle_conflict: "That X handle is already linked to another account.",
  x_handle_already_set: "Your account is already linked to a different X handle.",
};

/** Human copy for a `?x_error=` code, or null when there's no error. */
export function xErrorMessage(code: string | null): string | null {
  if (!code) return null;
  return X_ERROR_MESSAGES[code] ?? "X sign-in didn't complete. Please try again.";
}
