import { expect, test } from "@playwright/test";

import { mockApi } from "./support/mockApi";
import { expectNarrowViewportLayout } from "./support/narrowLayout";

/**
 * Golden path 2: browse the map and open its filters.
 *
 * Public in `proxy.ts`, so this runs signed out. The basemap and the points
 * endpoint are both mocked, so what is measured is the app's own chrome over
 * the canvas rather than a tile server's response time.
 */
test.describe("map", () => {
  test("browses on a narrow column", async ({ page }) => {
    await mockApi(page);
    await page.goto("/map");

    const filters = page.getByRole("button", { name: "Filters" });
    await expectNarrowViewportLayout(page, filters);
  });

  test("opens the filter panel on a narrow column", async ({ page }) => {
    await mockApi(page);
    await page.goto("/map");

    const filters = page.getByRole("button", { name: "Filters" });
    await expect(filters).toBeVisible();
    await filters.click();

    // The panel's own sections are where a phone column runs out of room, so
    // the three checks run again with the panel open.
    await expectNarrowViewportLayout(page, filters);
  });
});
