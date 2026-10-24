import type { BrowserContext, Page, Route } from "@playwright/test";

import { CSRF_COOKIE } from "@/lib/auth";

import {
  API_BASE_URL,
  APP_ORIGIN,
  BASEMAP_STYLE_URL_PATTERN,
  MEDIA_ORIGIN,
} from "./environment";
import {
  ANALYST_ORGANIZATIONS,
  ANALYST_PROFILE,
  ANALYST_STATS,
  COLLECTED_EVENT,
  COLLECTION,
  COLLECTION_ID,
  CONFLICTS,
  TAGS,
  UPLOAD,
  DEFAULT_PREFERENCES,
  EMPTY_BASEMAP_STYLE,
  EMPTY_DETECTIONS,
  EMPTY_SEARCH,
  EVENT,
  EVENT_APPROVALS,
  EVENT_ID,
  FEED_ITEMS,
  INVITE_CANDIDATES,
  NO_UNREAD,
  NOTIFICATION_FEED,
  ORGANIZATION,
  ORGANIZATION_APPROVALS,
  ORGANIZATION_INVITES,
  ORGANIZATION_MEMBERS,
  ORGANIZATION_APPROVAL_REQUESTS,
  ORGANIZATION_SLUG,
  ONE_PIXEL_PNG,
  REQUESTED_EVENT,
  SECOND_COLLECTED_EVENT,
  SECOND_COLLECTED_EVENT_DETAIL,
  SECOND_COLLECTED_EVENT_ID,
  SIGNED_IN_USER,
  X_HANDLE,
} from "./fixtures";

/**
 * The suite runs with no backend and no database. Every request the bundle
 * makes to `NEXT_PUBLIC_API_URL` is answered here instead, so a spec measures
 * layout against a fixed page rather than against whatever a live catalogue
 * happens to hold.
 */

/** Value the cookie carries. Nothing validates it: the mock is the backend. */
const CSRF_TOKEN = "e2e-csrf-token";

/**
 * Path inside the API base that each fixture answers, matched against the
 * pathname with the query dropped. The four golden paths reach every entry.
 */
const ROUTES: [RegExp, unknown][] = [
  [/^\/auth\/me$/, SIGNED_IN_USER],
  [/^\/auth\/login$/, SIGNED_IN_USER],
  [/^\/admin\/me$/, { is_admin: false }],
  [/^\/events\/detections$/, EMPTY_DETECTIONS],
  [/^\/users\/me\/preferences$/, DEFAULT_PREFERENCES],
  [/^\/users\/me\/x-handle$/, X_HANDLE],
  [/^\/notifications\/unread-count$/, NO_UNREAD],
  [/^\/notifications$/, NOTIFICATION_FEED],
  // The request board's first page. Every pattern here anchors on the whole
  // path, so the bare list, the detection queue above and the event by id
  // below stay distinct.
  [/^\/events$/, [REQUESTED_EVENT]],
  [/^\/events\/points$/, []],
  [/^\/feed$/, FEED_ITEMS],
  [/^\/search$/, EMPTY_SEARCH],
  [/^\/events\/possible-duplicates$/, []],
  [/^\/tags$/, TAGS],
  [/^\/uploads$/, UPLOAD],
  [/^\/conflicts$/, CONFLICTS],
  [new RegExp(`^/events/${EVENT_ID}$`), EVENT],
  [
    new RegExp(`^/events/${EVENT_ID}/approvals$`),
    { items: EVENT_APPROVALS, viewer_can_approve: false },
  ],
  // The owner's pending invitations, which the edit page's Geolocators card reads.
  [new RegExp(`^/events/${EVENT_ID}/geolocator-invites$`), []],
  [
    new RegExp(`^/events/${SECOND_COLLECTED_EVENT_ID}$`),
    SECOND_COLLECTED_EVENT_DETAIL,
  ],
  // The collection page: its header, then the one page of items the player,
  // the map and the list all read. Each item's own read answers above, which
  // is what the player's panel renders on the step it stands on.
  [new RegExp(`^/collections/${COLLECTION_ID}$`), COLLECTION],
  [
    new RegExp(`^/collections/${COLLECTION_ID}/events$`),
    [COLLECTED_EVENT, SECOND_COLLECTED_EVENT],
  ],
  // The organization page as its org manager reads it.
  [new RegExp(`^/organizations/${ORGANIZATION_SLUG}$`), ORGANIZATION],
  [new RegExp(`^/organizations/${ORGANIZATION_SLUG}/members$`), ORGANIZATION_MEMBERS],
  [new RegExp(`^/organizations/${ORGANIZATION_SLUG}/invites$`), ORGANIZATION_INVITES],
  [new RegExp(`^/organizations/${ORGANIZATION_SLUG}/approvals$`), ORGANIZATION_APPROVALS],
  [
    new RegExp(`^/organizations/${ORGANIZATION_SLUG}/approval-requests$`),
    ORGANIZATION_APPROVAL_REQUESTS,
  ],
  [
    new RegExp(`^/organizations/${ORGANIZATION_SLUG}/invite-candidates$`),
    INVITE_CANDIDATES,
  ],
  // The analyst's profile: its header, organizations and Insights figures.
  [new RegExp(`^/users/${SIGNED_IN_USER.username}$`), ANALYST_PROFILE],
  [new RegExp(`^/users/${SIGNED_IN_USER.username}/organizations$`), ANALYST_ORGANIZATIONS],
  [new RegExp(`^/users/${SIGNED_IN_USER.username}/stats$`), ANALYST_STATS],
  [
    new RegExp(`^/users/${SIGNED_IN_USER.username}/events$`),
    { items: [], total: 0, page: 1, per_page: 5 },
  ],
  // The profile's Collections grid, which the signed-in analyst owns.
  [
    new RegExp(`^/users/${SIGNED_IN_USER.username}/collections$`),
    { items: [COLLECTION], total: 1, page: 1, per_page: 4 },
  ],
];

/** The prefix `lib/api.ts` puts in front of every path it requests. */
const API_PATH_PREFIX = new URL(API_BASE_URL).pathname;

function bodyFor(path: string): unknown {
  for (const [pattern, body] of ROUTES) {
    if (pattern.test(path)) return body;
  }
  // A path none of the four golden paths reaches today. An empty list keeps a
  // page that grows a new call from painting an error banner over the layout
  // under measurement: this suite measures geometry, and a missing fixture is
  // not a layout failure. The warning names it, so a spec that starts
  // measuring an empty section says so in the run log rather than passing
  // quietly on a fixture nobody wrote.
  console.warn(`mockApi: no fixture for ${path}, answering with an empty list`);
  return [];
}

async function fulfilApiRequest(route: Route): Promise<void> {
  const path = new URL(route.request().url()).pathname.replace(
    API_PATH_PREFIX,
    "",
  );
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(bodyFor(path)),
  });
}

function servePng(route: Route): Promise<void> {
  return route.fulfill({
    status: 200,
    contentType: "image/png",
    body: ONE_PIXEL_PNG,
  });
}

/**
 * Intercept the backend, the basemap and the media fixture on `page`.
 *
 * Register it before the first navigation: `AuthContext` fires `/auth/me` as
 * the app boots, so a route installed afterwards misses it.
 */
export async function mockApi(page: Page): Promise<void> {
  await page.route(`${API_BASE_URL}/**`, fulfilApiRequest);
  await page.route(BASEMAP_STYLE_URL_PATTERN, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(EMPTY_BASEMAP_STYLE),
    }),
  );
  // The media fixture, the `_hero` / `_thumb` siblings `lib/mediaUrls.ts`
  // derives from it, and the optimizer route `next/image` rewrites them to.
  await page.route(`${MEDIA_ORIGIN}/**`, servePng);
  await page.route(`${APP_ORIGIN}/_next/image**`, servePng);
}

/**
 * Give the context the session cookie `proxy.ts` gates the private paths on.
 * The middleware only checks that it is there, and `/auth/me` above answers
 * with the user the app then renders, so the two agree on "signed in".
 */
export async function grantSession(context: BrowserContext): Promise<void> {
  await context.addCookies([
    { name: CSRF_COOKIE, value: CSRF_TOKEN, url: APP_ORIGIN },
  ]);
}

/**
 * Answer one API path with `body` instead of its fixture, for a spec that needs another shape of
 * the same row (a site admin, an event with more sources). Register it after `mockApi`: the route
 * registered last is tried first.
 */
export async function answerWith(page: Page, path: string, body: unknown): Promise<void> {
  const target = new URL(`${API_BASE_URL}${path}`);
  // Matched on the origin and path, so a query string does not slip past the override.
  const matches = (url: URL) => url.origin === target.origin && url.pathname === target.pathname;
  await page.route(matches, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) }),
  );
}
