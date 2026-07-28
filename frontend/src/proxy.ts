import { NextRequest, NextResponse } from "next/server";

const CANONICAL_HOST = "vidit.app";

// Mirrors `CSRF_COOKIE` in `lib/auth.ts`. Inlined because importing
// `lib/auth.ts` pulls in a `document.cookie` reference the edge runtime
// lacks. The backend sets/clears it in lockstep with the HttpOnly session
// cookie, so its presence is a good-enough proxy for "has a session" —
// validating the JWT here would add a dependency for a UX-flash fix only;
// a stale cookie still 401s at the API and the page bounces in its effect.
const CSRF_COOKIE = "vidit_csrf";

// Paths reachable WITHOUT a session; everything else is default-deny below.
// Anonymous read is open: the content routes (map, events, requests,
// profiles, search) are public. Write and account surfaces (`/submit`,
// `/import`, `/settings`, `/admin`, `/timeline`) stay behind the wall;
// write sub-routes living under a public prefix (`/events/[id]/edit`,
// `/profile/[username]/detections`) are bounced client-side by
// `useRequireAuth`. The invite code gates registration only (at
// `POST /auth/register`) — no site-wide gate cookie.
const PUBLIC_EXACT = new Set<string>(["/"]);
const PUBLIC_PREFIXES = [
  "/about",
  // The bot format guide: the destination behind the bot's bio and pinned
  // post, read by analysts with no Vidit session yet.
  "/bot",
  // The Sentry tunnel: browsers POST error envelopes here (rewritten to
  // Sentry ingest by next.config's tunnelRoute). Anonymous readers crash
  // too; behind the wall their reports redirected to /login and died 405.
  "/monitoring",
  "/map",
  "/events",
  "/requests",
  "/profile",
  "/search",
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
  // Round-trip the original destination so login lands the user back where
  // they came from. The login page sanitises it before honouring it
  // (open-redirect guard against `//evil.com`).
  const target = request.nextUrl.pathname + request.nextUrl.search;
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(target)}`;
  return NextResponse.redirect(url);
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = !!request.cookies.get(CSRF_COOKIE);

  // 1. Host redirect, PROD ONLY (would bounce localhost to vidit.app).
  // Collapse EVERY non-canonical alias (www, per-deploy hash URLs, the
  // project alias, anything pointed at the build) onto the apex, killing
  // duplicate-content surface. www is deliberately NOT exempted: Vercel
  // serves the app on it with a 200 (no domain-layer redirect), and a page
  // loaded on www dies on the API's CORS allowlist (the login preflight
  // 400s), so the middleware owns the 308 whatever the Vercel domain config
  // says. Strip an optional `:port` before the equality check; a stray
  // `Host: vidit.app:443` would otherwise miss the match and redirect-loop.
  if (process.env.NODE_ENV !== "development") {
    const host = request.headers.get("host") ?? "";
    const hostOnly = host.split(":")[0];
    if (hostOnly && hostOnly !== CANONICAL_HOST) {
      const url = request.nextUrl.clone();
      url.protocol = "https:";
      url.hostname = CANONICAL_HOST;
      url.port = "";
      return NextResponse.redirect(url, 308);
    }
  }

  // 2. Default-deny auth wall — DEV AND PROD. Anything outside the public
  // set requires a session, redirected at the edge BEFORE the page renders
  // so gated surfaces never render for a signed-out visitor. Runs in
  // dev too so local matches production (log in as the seeded admin).
  if (!isPublic(pathname) && !hasSession) {
    return redirectToLogin(request);
  }

  return NextResponse.next();
}

export const config = {
  // Run on every request except Next.js internals and well-known static
  // assets. Icon / apple-icon / manifest stay public — an auth redirect on
  // a favicon request makes the tab fall back to its default stub icon.
  // `opengraph-image` / `twitter-image` are Next.js metadata routes served
  // at `/opengraph-image?<hash>` (hash = cache busting); social crawlers
  // fetch them unauthenticated, so they must bypass the wall too — else the
  // pinned tweet renders login-redirect HTML instead of the og:image.
  //
  // The lookahead is anchored at the path start, so it only excludes
  // ROOT-LEVEL `/opengraph-image` + `/twitter-image`. The `/about/...`
  // variants ride on the `/about` entry in `PUBLIC_PREFIXES`. If `/about`
  // ever moves behind auth, its social card breaks — widen this matcher to
  // the segment-nested form (e.g. `.*opengraph-image`) then.
  matcher: [
    "/((?!_next|favicon.ico|icon|apple-icon|manifest.webmanifest|robots.txt|sitemap.xml|opengraph-image|twitter-image).*)",
  ],
};
