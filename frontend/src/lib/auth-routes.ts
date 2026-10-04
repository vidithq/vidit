// Auth-flow routes: `<Sidebar>` and `<BetaBanner>` hide here so sign-in and register render
// without chrome. Not the full public set (`/`, `/about`; see `PUBLIC_*` in `proxy.ts`).

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
