import { expect, test } from "@playwright/test";

import { grantSession, mockApi } from "./support/mockApi";
import { expectNarrowViewportLayout } from "./support/narrowLayout";

/**
 * Golden path 3: the submit page, in each of the two modes it opens in.
 *
 * `/submit` sits behind the auth wall, so the context carries the session
 * cookie `proxy.ts` checks and `/auth/me` answers with the fixture user.
 * `/geolocations/new` redirects here, preserving its query.
 */
test.describe("submit", () => {
  test.beforeEach(async ({ context, page }) => {
    await grantSession(context);
    await mockApi(page);
  });

  test("fills the single-event form on a narrow column", async ({ page }) => {
    await page.goto("/submit");

    const publish = page.getByRole("button", { name: "Publish geolocation" });
    await expectNarrowViewportLayout(page, publish);
  });

  test("reads an X post on a narrow column", async ({ page }) => {
    await page.goto("/submit");

    const modes = page.getByRole("group", { name: "Submission mode" });
    await expect(modes).toBeVisible();
    await modes.getByRole("button", { name: "From an X post" }).click();

    const createDetection = page.getByRole("button", {
      name: "Create the detection",
    });
    await expectNarrowViewportLayout(page, createDetection);
  });

  test("the legacy route redirects here", async ({ page }) => {
    await page.goto("/geolocations/new");
    await expect(page).toHaveURL(/\/submit$/);
  });
});
