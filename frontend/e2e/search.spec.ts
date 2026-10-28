import { expect, test } from "@playwright/test";

import { REQUESTED_EVENT, SITE } from "./support/fixtures";
import { mockApi } from "./support/mockApi";
import { expectNarrowViewportLayout } from "./support/narrowLayout";

/**
 * The search page with no kind picked: one section per kind, each heading row
 * ending on See all while the kind holds more. The site's long name is the
 * narrowest row. Public in `proxy.ts`, so this runs signed out.
 */
test.describe("search", () => {
  test("lists the sections inside a narrow column", async ({ page }) => {
    await mockApi(page);
    await page.goto("/search?q=rail");

    const events = page.getByRole("region", { name: "Events" });
    await expect(events.getByRole("link", { name: REQUESTED_EVENT.title })).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Sites" }).getByRole("link", { name: SITE.name }),
    ).toBeVisible();
    await expect(page.getByRole("searchbox")).toBeFocused();
    await expectNarrowViewportLayout(page, events.getByRole("link", { name: "See all" }));
  });
});
