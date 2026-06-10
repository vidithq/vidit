// The auth-flow routes. `<Sidebar>` and `<ClosedBetaBanner>` hide on these
// pages so sign-in / register render without app chrome.
//
// Auth-flow subset only, NOT the full public set (`/` and `/about` are also
// public — see `PUBLIC_*` in `proxy.ts`). Kept separate because this
// predicate is permanent: the sidebar stays hidden here after the
// closed-beta wall comes down at public launch.

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
