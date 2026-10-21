import { expect, test } from "@playwright/test";

import { SITE, SITE_ID } from "./support/fixtures";
import { grantSession, mockApi } from "./support/mockApi";
import {
  expectControlInsideViewport,
  expectNarrowViewportLayout,
  expectNoHorizontalOverflow,
} from "./support/narrowLayout";

/**
 * A site page, read by a signed-in analyst.
 *
 * Signed in, because the actions card and the two forms it opens are the
 * narrow case: the header holds a long name beside two pills and a byline, the
 * history rows put a date column beside effect pills, and the observation
 * form stacks a map, a toolbar and two field rows.
 */
test.describe("site page", () => {
  test("lays the header, the zone and the history out inside the column", async ({
    context,
    page,
  }) => {
    await grantSession(context);
    await mockApi(page);
    await page.goto(`/sites/${SITE_ID}`);

    await expect(page.getByRole("heading", { name: SITE.name })).toBeVisible();
    await expect(page.getByText("Link effect changed:")).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // The clock switch is the history's one control.
    await expectControlInsideViewport(page, page.getByRole("button", { name: "Date added to Vidit" }));
    await expectControlInsideViewport(page, page.getByRole("button", { name: "Add an observation" }));
  });

  test("opens the observation form inside the column", async ({ context, page }) => {
    await grantSession(context);
    await mockApi(page);
    await page.goto(`/sites/${SITE_ID}`);

    await page.getByRole("button", { name: "Add an observation" }).click();
    await expect(page.getByRole("heading", { name: "Add an observation" })).toBeVisible();
    await expectNarrowViewportLayout(page, page.getByRole("button", { name: "Save observation" }));
    await expectControlInsideViewport(page, page.getByRole("button", { name: "Redraw" }));
  });

  test("opens the link dialog inside the viewport", async ({ context, page }) => {
    await grantSession(context);
    await mockApi(page);
    await page.goto(`/sites/${SITE_ID}`);

    await page.getByRole("button", { name: "Link one of my events" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Link one of your events" })).toBeVisible();
    await expectNarrowViewportLayout(page, dialog.getByRole("button", { name: "Link", exact: true }));
    await expectControlInsideViewport(page, dialog.getByRole("button", { name: "Destruction" }));
  });
});
