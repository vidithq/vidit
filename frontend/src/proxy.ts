import { NextRequest, NextResponse } from "next/server";

const CANONICAL_HOST = "vidit.app";

// Mirrors `CSRF_COOKIE` in `lib/auth.ts`; change both. Inlined because `lib/auth.ts` touches
// `document.cookie`, absent in the edge runtime. The backend sets and clears it with the
// HttpOnly session cookie, so its presence proxies "has a session"; a stale cookie still 401s
// at the API and the page bounces in its effect.
const CSRF_COOKIE = "vidit_csrf";

// Paths reachable without a session; everything else is default-deny. Content routes (map,
// events, requests, profiles, search) are public. Write and account surfaces (`/submit`,
// `/settings`, `/admin`, `/timeline`) stay behind the wall; write sub-routes under a public
// prefix (`/events/[id]/edit`, `/profile/[username]/detections`) bounce client side via
// `useRequireAuth`. The invite code gates registration only (`POST /auth/register`).
const PUBLIC_EXACT = new Set<string>(["/"]);
const PUBLIC_PREFIXES = [
  "/about",
  // Import guide: read by analysts before they have a session.
  "/import",
  // Redirects into the import guide: `/archive` (published links) and `/bot` (the bot's X bio
  // and pinned post). Public so a signed-out reader is forwarded, not bounced to login.
  "/archive",
  "/bot",
  "/guide",
  // Legal notice: must be reachable by anyone, an authority included.
  "/legal",
  // Privacy policy, read before signing up as often as after.
  "/privacy",
  "/methodology",
  // Sentry tunnel (rewritten to ingest by next.config's tunnelRoute): anonymous readers crash
  // too, and behind the wall their reports redirected to /login and died 405.
  "/monitoring",
  "/map",
  // A collection reads anonymously on its owner's public profile, like the events it holds.
  "/collections",
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
  // Round-trip the destination; the login page sanitises it (open-redirect guard against
  // `//evil.com`).
  const target = request.nextUrl.pathname + request.nextUrl.search;
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(target)}`;
  return NextResponse.redirect(url);
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = !!request.cookies.get(CSRF_COOKIE);

  // 1. Host redirect, PROD ONLY (it would bounce localhost). Collapse every non-canonical alias
  // (www, per-deploy URLs, the project alias) onto the apex. www is deliberately not exempt:
  // Vercel serves it with a 200 and a page loaded there dies on the API's CORS allowlist, so
  // this owns the 308. Strip an optional `:port` first, or `Host: vidit.app:443` would
  // redirect-loop.
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

  // 2. Default-deny auth wall, dev and prod (so local matches production). Redirects at the edge
  // before the page renders, so gated surfaces never render for a signed-out visitor.
  if (!isPublic(pathname) && !hasSession) {
    return redirectToLogin(request);
  }

  return NextResponse.next();
}

export const config = {
  // Every request except Next.js internals and well-known static assets. Icon, apple-icon and
  // manifest stay public (an auth redirect on a favicon makes the tab fall back to a stub
  // icon). `maplibre-gl/` is the map's web worker: behind the wall it would get the login page
  // and the map renders blank. `opengraph-image` / `twitter-image` metadata routes are fetched
  // unauthenticated by social crawlers, so they bypass the wall too.
  //
  // The lookahead is anchored at the path start, so it only excludes root-level cards.
  // Segment-nested cards ride on their page's `PUBLIC_PREFIXES` entry (`/events`, `/profile`,
  // `/about`); moving one of those behind auth breaks its social card, so widen the matcher
  // (e.g. `.*opengraph-image`) then.
  matcher: [
    "/((?!_next|favicon.ico|icon|apple-icon|manifest.webmanifest|maplibre-gl/|robots.txt|sitemap.xml|opengraph-image|twitter-image).*)",
  ],
};
