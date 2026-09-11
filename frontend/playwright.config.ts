import { defineConfig, devices } from "@playwright/test";

import { API_BASE_URL, APP_ORIGIN, APP_PORT } from "./e2e/support/environment";

/**
 * Narrow-viewport smoke suite: four golden paths, each measured at the two
 * phone widths the app has to hold, with the backend mocked in the browser.
 *
 * No screenshot comparison anywhere. The assertions are geometric (see
 * `e2e/support/narrowLayout.ts`), so they read the same on a laptop and on a
 * CI runner with different fonts.
 */

/** The two columns every spec runs in: a current phone and the narrowest one. */
const VIEWPORTS = [
  { name: "chromium-375x812", width: 375, height: 812 },
  { name: "chromium-320x568", width: 320, height: 568 },
];

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // No retries anywhere. Every assertion here is geometric against a page
  // served from fixtures, so a failure is a layout regression and a retry
  // would only hide a flaky one behind a second green run.
  retries: 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "list" : "line",
  // The dev server compiles a route on its first request, so the first
  // navigation of each spec pays a compile the later ones do not.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: APP_ORIGIN,
    // With no retries there is no second run to trace, so a trace is kept on
    // the failing run itself. `.gitignore` holds `test-results/`, and the CI
    // job uploads it when the suite goes red.
    trace: "retain-on-failure",
  },
  // Desktop Chrome at phone widths, not a device profile: what is measured is
  // the CSS the width selects, so no touch emulation, no mobile user agent and
  // no device pixel ratio. A spec that needs a finger (the map's coarse-pointer
  // hit slop) belongs in a project that emulates one.
  projects: VIEWPORTS.map(({ name, width, height }) => ({
    name,
    use: { ...devices["Desktop Chrome"], viewport: { width, height } },
  })),
  webServer: {
    // `next dev`, not a production build. `proxy.ts` collapses every
    // non-canonical host onto `vidit.app` with a 308 outside development, so a
    // `next start` server on localhost answers each navigation with a redirect
    // to the live site and the suite measures production instead of this
    // worktree. The dev server runs with `NODE_ENV=development`, which is the
    // one branch that skips the host redirect; the auth wall below it still
    // runs, so the gated paths are gated exactly as they are in production.
    command: "npm run dev",
    url: APP_ORIGIN,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: {
      // `lib/api.ts` bakes this into the client bundle, which is what makes the
      // `page.route` pattern in `e2e/support/mockApi.ts` deterministic.
      NEXT_PUBLIC_API_URL: API_BASE_URL,
      PORT: String(APP_PORT),
    },
  },
});
