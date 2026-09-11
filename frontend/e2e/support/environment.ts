/**
 * The addresses the narrow-viewport suite runs against.
 *
 * Both are fixed rather than read from the ambient environment: the specs
 * intercept the API origin with `page.route`, so the pattern they register has
 * to be the exact origin the bundle was built with. `playwright.config.ts`
 * hands `API_BASE_URL` to the web server as `NEXT_PUBLIC_API_URL`, which
 * `lib/api.ts` bakes into the client bundle at build time, so the two sides
 * read the same value from here.
 */

/** Port the suite's Next server listens on, away from the dev default. */
export const APP_PORT = 3100;

/** Origin the suite browses. */
export const APP_ORIGIN = `http://localhost:${APP_PORT}`;

/**
 * Fake backend origin, including the `/api/v1` suffix `lib/api.ts` expects.
 * Nothing listens on it: every request is fulfilled by `mockApi`.
 */
export const API_BASE_URL = "http://localhost:9999/api/v1";

/**
 * Origin the media fixture is served from. `next.config.mjs` allows it under
 * `images.remotePatterns` when the API host is local, which the fake origin
 * above is, so `next/image` accepts a `src` on it.
 */
export const MEDIA_ORIGIN = "http://localhost:8000";

/**
 * CARTO serves the basemap style `components/map/Map.tsx` names. Mocked too,
 * so `/map` renders without reaching the network.
 */
export const BASEMAP_STYLE_URL_PATTERN = "https://basemaps.cartocdn.com/**";
