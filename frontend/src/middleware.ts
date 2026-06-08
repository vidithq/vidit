import { NextRequest, NextResponse } from "next/server";

const CANONICAL_HOST = "vidit.app";

// Mirrors `CSRF_COOKIE` in `lib/auth.ts`. Inlined here because middleware
// runs on the edge runtime and importing `lib/auth.ts` pulls in a
// `document.cookie` reference that doesn't exist there. The CSRF cookie
// is the JS-visible proxy for the HttpOnly session cookie — set and
// cleared together by the backend, so its presence tracks "has an active
// session" without us having to validate the JWT here (which would
// require an extra dependency for what's only meant as a UX-flash fix —
// any cookie that survives logout still 401s at the API and the page
// can still bounce in its own effect).
const CSRF_COOKIE = "vidit_csrf";

// === Public storefront ===
// Paths reachable WITHOUT a session. Everything else requires login
// (default-deny, below). This is the closed-beta face of the site: `/`
// (the landing — pitch + about video + public roadmap) and `/about` let a
// skeptic evaluate Vidit before committing to an account, and the
// auth-flow pages must stay reachable so a logged-out visitor can actually
// sign in or register. The invite code now gates registration only
// (validated at `POST /auth/register`) — there is no separate site-wide
// gate cookie any more.
//
// When anonymous read opens, the content routes get added to
// this set: `/map`, `/geolocations/[id]`, `/profile/[username]`,
// `/bounties`. Until then a logged-in account is the closed-beta wall —
// a strictly stronger lock than the old shared `vidit_beta_gate` cookie.
const PUBLIC_EXACT = new Set<string>(["/"]);
const PUBLIC_PREFIXES = [
  "/about",
  "/login",
  "/register",
  "/registration-pending",
  "/confirm-registration",
  "/resend-confirmation",
  "/forgot-password",
  "/reset-password",
];

function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

function redirectToLogin(request: NextRequest): NextResponse {
  const url = request.nextUrl.clone();
  // Round-trip the original destination so the login page can land the
  // user back where they came from instead of dumping everyone onto the
  // map. The login page sanitises the value before honouring it
  // (open-redirect guard against `//evil.com`).
  const target = request.nextUrl.pathname + request.nextUrl.search;
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(target)}`;
  return NextResponse.redirect(url);
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = !!request.cookies.get(CSRF_COOKIE);

  // 1. Host redirect — PROD ONLY (it would bounce localhost back to
  // vidit.app, which is hostile to local development). Collapse
  // non-canonical aliases (per-deploy hash URLs, the project alias
  // `vidit-frontend.vercel.app`, anything ever pointed at the build) onto
  // the production apex. `www.vidit.app` is already 308'd by Vercel's own
  // domain config, so we let it pass through without a second hop. Kills
  // duplicate-content surface.
  //
  // Strip an optional `:port` before the equality check — Vercel-served
  // prod traffic doesn't carry one, but a stray `Host: vidit.app:443`
  // header would otherwise miss the match and redirect-loop.
  if (process.env.NODE_ENV !== "development") {
    const host = request.headers.get("host") ?? "";
    const hostOnly = host.split(":")[0];
    if (
      hostOnly &&
      hostOnly !== CANONICAL_HOST &&
      hostOnly !== `www.${CANONICAL_HOST}`
    ) {
      const url = request.nextUrl.clone();
      url.protocol = "https:";
      url.hostname = CANONICAL_HOST;
      url.port = "";
      return NextResponse.redirect(url, 308);
    }
  }

  // 2. Default-deny auth wall — DEV AND PROD. Anything outside the public
  // storefront + auth flow requires a session, redirected at the edge
  // BEFORE the page renders so closed-beta content (the map, geolocation
  // detail, bounties, profiles, …) never renders for a signed-out visitor.
  // Runs in dev too so local development matches production — the map is
  // gated the same way it is live; log in (e.g. the seeded admin) to reach
  // it. Replaces the old beta-gate cookie redirect.
  if (!isPublic(pathname) && !hasSession) {
    return redirectToLogin(request);
  }

  return NextResponse.next();
}

export const config = {
  // Run on every request except Next.js internals and well-known static
  // assets. The middleware function decides per-path whether to apply the
  // host redirect or the auth wall.
  //
  // Icon / Apple-touch-icon / manifest routes also stay public — the
  // browser requests them on every page load and an auth redirect on a
  // favicon request makes the tab fall back to its default stub icon.
  // `opengraph-image` and `twitter-image` are Next.js metadata file
  // conventions served at `/opengraph-image?<hash>` / `/twitter-image?<hash>`
  // (the hash rides as a query string for cache busting); social
  // crawlers fetch them unauthenticated, so they must bypass the auth
  // wall the way favicons do — otherwise the pinned tweet renders the
  // login redirect HTML instead of the og:image.
  //
  // The negative lookahead is anchored at the start of the path, so the
  // exclusion only covers ROOT-LEVEL `/opengraph-image` + `/twitter-image`.
  // The about-page variants at `/about/opengraph-image` ride on the
  // pre-existing `/about` entry in `PUBLIC_PREFIXES` above — `isPublic`
  // short-circuits before the auth check. If `/about` is ever moved
  // behind auth, the about-page social card silently breaks; widen this
  // matcher to cover the segment-nested form (e.g. `.*opengraph-image`)
  // at that point.
  matcher: [
    "/((?!_next|favicon.ico|icon|apple-icon|manifest.webmanifest|robots.txt|sitemap.xml|opengraph-image|twitter-image).*)",
  ],
};
