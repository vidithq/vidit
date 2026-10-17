import { expect, test } from "@playwright/test";

import { EVENT_ID } from "./support/fixtures";
import { grantSession, mockApi } from "./support/mockApi";
import { expectNarrowViewportLayout } from "./support/narrowLayout";

/**
 * The owner's edit of a published geolocation. From `lg` up the actions and the geolocators sit
 * in the right rail; on a phone the rail stacks under the fields, so Save is never the first
 * thing on the page.
 */
test.describe("event edit", () => {
  test.beforeEach(async ({ context, page }) => {
    await grantSession(context);
    await mockApi(page);
  });

  test("stacks the actions card under the fields on a narrow column", async ({ page }) => {
    await page.goto(`/events/${EVENT_ID}/edit`);

    const save = page.getByRole("button", { name: "Save version 2" });
    await expectNarrowViewportLayout(page, save);

    const fields = await page.locator("form#event-edit-form").boundingBox();
    const saveBox = await save.boundingBox();
    expect(fields!.y + fields!.height).toBeLessThanOrEqual(saveBox!.y);

    // The close follows the save in the same card, and the geolocators come last.
    const close = page.getByRole("button", { name: "Close this geolocation" });
    const closeBox = await close.boundingBox();
    expect(saveBox!.y + saveBox!.height).toBeLessThanOrEqual(closeBox!.y);
    const geolocators = await page.getByRole("heading", { name: /^Geolocators/ }).boundingBox();
    expect(closeBox!.y + closeBox!.height).toBeLessThanOrEqual(geolocators!.y);
    await expect(page.getByRole("button", { name: "Invite" })).toBeVisible();
  });
});
