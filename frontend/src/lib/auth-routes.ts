// Routes a user can reach without a session — the auth flow. Used by
// always-on UI affordances: `<Sidebar>` and `<ClosedBetaBanner>` hide
// themselves on these pages so the sign-in / register screens render
// without app chrome.
//
// This is the auth-flow subset only; it is NOT the full public set (the
// landing `/` and `/about` are public too — see `PUBLIC_*` in
// `proxy.ts`). Kept separate from the proxy lists because this
// predicate is permanent — the sidebar still needs to stay hidden on
// /login etc. after the closed-beta wall comes down at public launch.

export function isAuthRoute(pathname: string): boolean {
  return (
    pathname.startsWith("/login") ||
    pathname.startsWith("/register") ||
    pathname.startsWith("/registration-pending") ||
    pathname.startsWith("/confirm-registration") ||
    pathname.startsWith("/resend-confirmation") ||
    pathname.startsWith("/forgot-password") ||
    pathname.startsWith("/reset-password")
  );
}
