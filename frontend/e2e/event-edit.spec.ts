import { expect, test } from "@playwright/test";

import { EVENT, EVENT_ID } from "./support/fixtures";
import { answerWith, grantSession, mockApi } from "./support/mockApi";
import { expectNarrowViewportLayout } from "./support/narrowLayout";

/**
 * The one edit form: the owner's correction of a published geolocation, and the publish of a
 * request. From `lg` up the actions sit in the right rail; on a phone the rail stacks under the
 * fields, so the write is never the first thing on the page.
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

  test("publishes a request from the same form, its requirements listed", async ({ page }) => {
    await answerWith(page, `/events/${EVENT_ID}`, {
      ...EVENT,
      status: "requested",
      version_no: 0,
      version_zero: "request",
      geolocated_at: null,
      geolocators: [],
      conflicts: [],
    });
    await page.goto(`/events/${EVENT_ID}/edit`);

    const publish = page.getByRole("button", { name: "Publish", exact: true });
    await expectNarrowViewportLayout(page, publish);
    const rail = page.getByRole("complementary", { name: "Actions" });
    await expect(rail.getByText("Conflict", { exact: true })).toBeVisible();
    await expect(rail.getByRole("button", { name: "Save request" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Save version/ })).toHaveCount(0);
  });
});
