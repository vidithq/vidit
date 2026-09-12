import type { BrowserContext, Page, Route } from "@playwright/test";

import { CSRF_COOKIE } from "@/lib/auth";

import {
  API_BASE_URL,
  APP_ORIGIN,
  BASEMAP_STYLE_URL_PATTERN,
  MEDIA_ORIGIN,
} from "./environment";
import {
  COLLECTED_EVENT,
  COLLECTION,
  COLLECTION_ID,
  CONFLICTS,
  CURATED_TAGS,
  EMPTY_BASEMAP_STYLE,
  EMPTY_DETECTIONS,
  EVENT,
  EVENT_ID,
  ONE_PIXEL_PNG,
  REQUESTED_EVENT,
  SIGNED_IN_USER,
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
  // The request board's first page. Every pattern here anchors on the whole
  // path, so the bare list, the detection queue above and the event by id
  // below stay distinct.
  [/^\/events$/, [REQUESTED_EVENT]],
  [/^\/events\/points$/, []],
  [/^\/events\/possible-duplicates$/, []],
  [/^\/tags$/, CURATED_TAGS],
  [/^\/conflicts$/, CONFLICTS],
  [new RegExp(`^/events/${EVENT_ID}$`), EVENT],
  // The collection page: its header, then the one page of items the map and
  // the list both read.
  [new RegExp(`^/collections/${COLLECTION_ID}$`), COLLECTION],
  [new RegExp(`^/collections/${COLLECTION_ID}/events$`), [COLLECTED_EVENT]],
  // The profile's Collections grid, which the signed-in analyst owns.
  [
    new RegExp(`^/users/${SIGNED_IN_USER.username}/collections$`),
    { items: [COLLECTION], total: 1, page: 1, per_page: 6 },
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
