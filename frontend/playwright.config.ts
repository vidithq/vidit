import { defineConfig, devices } from "@playwright/test";

import { API_BASE_URL, APP_ORIGIN, APP_PORT } from "./e2e/support/environment";

/**
 * Narrow-viewport smoke suite: the golden paths and the narrow pages, each
 * measured at the two phone widths the app has to hold, with the backend mocked
 * in the browser. A spec that needs a wide screen sets its own viewport.
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
  // A CI runner has 4 vCPUs, and the server plus two browsers already fill
  // them: at four workers each test ran twice as long and the suite finished
  // no sooner.
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? "list" : "line",
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
  // no device pixel ratio. A spec that needs a finger (a swipe, a tap on an
  // approval stamp) sets `hasTouch` in its own `test.use`.
  projects: VIEWPORTS.map(({ name, width, height }) => ({
    name,
    use: { ...devices["Desktop Chrome"], viewport: { width, height } },
  })),
  webServer: {
    // A production build, not `next dev`. The dev server compiles each route
    // on its first request and renders development React, so on a CI runner
    // the build plus a run on `next start` finishes before a run on the dev
    // server alone. `proxy.ts` exempts `localhost` from its host redirect, so
    // `next start` serves this worktree; the auth wall still runs, so the
    // gated paths are gated exactly as they are in production.
    command: "npm run build && npm run start",
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
