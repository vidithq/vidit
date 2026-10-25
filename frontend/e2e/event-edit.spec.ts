import { expect, test } from "@playwright/test";

import { EVENT, EVENT_ID } from "./support/fixtures";
import { answerWith, grantSession, mockApi } from "./support/mockApi";
import { expectNarrowViewportLayout } from "./support/narrowLayout";

/**
 * The one edit form: the owner's correction of a published geolocation, and the publish of a
 * request. From `lg` up the actions head the side column; on a phone they stack under the
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

    // The last field block, Location, ends above the actions.
    const location = await page.getByRole("heading", { name: /^Location/ }).locator("xpath=ancestor::section[1]").boundingBox();
    const saveBox = await save.boundingBox();
    expect(location!.y + location!.height).toBeLessThanOrEqual(saveBox!.y);

    // The close follows the save in the same card, and the geolocators come last.
    const close = page.getByRole("button", { name: "Close this geolocation" });
    const closeBox = await close.boundingBox();
    expect(saveBox!.y + saveBox!.height).toBeLessThanOrEqual(closeBox!.y);
    const geolocators = await page.getByRole("heading", { name: /^Geolocators/ }).boundingBox();
    expect(closeBox!.y + closeBox!.height).toBeLessThanOrEqual(geolocators!.y);
    await expect(page.getByRole("button", { name: "Invite" })).toBeVisible();
  });

  test("puts the actions top right, over the details and the location, on a wide screen", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/events/${EVENT_ID}/edit`);

    const rail = page.getByRole("complementary", { name: "Actions and geolocators" });
    await expect(rail.getByRole("button", { name: "Save version 2" })).toBeVisible();
    const box = async (name: string) =>
      (await page.getByRole("heading", { name: new RegExp(`^${name}`) }).boundingBox())!;
    const railBox = (await rail.boundingBox())!;
    const title = (await page.getByLabel("Title", { exact: true }).boundingBox())!;
    const [sources, proof, details, location] = [
      await box("Sources"),
      await box("Proof"),
      await box("Details"),
      await box("Location"),
    ];
    // Main column: title, sources, proof. Side column: actions, details, location.
    expect(railBox.x).toBeGreaterThan(title.x + title.width);
    expect(sources.y).toBeGreaterThan(title.y);
    expect(proof.y).toBeGreaterThan(sources.y);
    expect(details.x).toBeGreaterThanOrEqual(railBox.x);
    expect(details.y).toBeGreaterThanOrEqual(railBox.y + railBox.height);
    expect(location.y).toBeGreaterThan(details.y);
    // The actions start no lower than the title field.
    expect(railBox.y).toBeLessThanOrEqual(title.y);
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
