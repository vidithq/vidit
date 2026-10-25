import { expect, test } from "@playwright/test";

import { EVENT, EVENT_ID } from "./support/fixtures";
import { answerWith, grantSession, mockApi } from "./support/mockApi";
import { expectNarrowViewportLayout, expectNoHorizontalOverflow } from "./support/narrowLayout";

/**
 * The one edit form: the owner's correction of a published geolocation, and the publish of a
 * request. The writes are the page's sticky actions, top right of the header: they stay pinned at
 * the top of the viewport while the fields scroll under them, and Publish counts the requirements
 * it still misses.
 */
test.describe("event edit", () => {
  test.beforeEach(async ({ context, page }) => {
    await grantSession(context);
    await mockApi(page);
  });

  test("keeps the save pinned over the fields on a narrow column", async ({ page }) => {
    await page.goto(`/events/${EVENT_ID}/edit`);

    const actions = page.getByRole("complementary", { name: "Actions" });
    const save = actions.getByRole("button", { name: "Save version 2" });
    await expectNarrowViewportLayout(page, save);
    // A version needs the publish floor too, but only a publish counts it.
    await expect(actions.getByRole("button", { name: /missing/ })).toHaveCount(0);

    // At rest the actions sit above the title field; the close waits behind More actions.
    const title = page.getByLabel("Title", { exact: true });
    expect((await actions.boundingBox())!.y + (await actions.boundingBox())!.height).toBeLessThanOrEqual(
      (await title.boundingBox())!.y,
    );
    await expect(page.getByRole("button", { name: "Close this geolocation" })).toHaveCount(0);
    await actions.getByRole("button", { name: "More actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Close this geolocation" })).toBeVisible();
    await page.keyboard.press("Escape");

    // The version note heads the side column, over Location; the geolocators follow Details.
    const note = (await page.getByRole("textbox", { name: "Version note" }).boundingBox())!;
    const location = (await page.getByRole("heading", { name: /^Location/ }).boundingBox())!;
    const details = (await page.getByRole("heading", { name: /^Details/ }).boundingBox())!;
    const geolocators = page.getByRole("heading", { name: /^Geolocators/ });
    expect(note.y).toBeLessThan(location.y);
    expect((await geolocators.boundingBox())!.y).toBeGreaterThan(details.y);

    // Scrolled to the geolocators, the save is still on screen, pinned at the top.
    await geolocators.scrollIntoViewIfNeeded();
    await expect(page.getByRole("button", { name: "Invite" })).toBeVisible();
    await expect(save).toBeInViewport({ ratio: 1 });
    await expectNoHorizontalOverflow(page);
  });

  test("puts the actions top right, over the location and the details, on a wide screen", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/events/${EVENT_ID}/edit`);

    const rail = page.getByRole("complementary", { name: "Actions" });
    await expect(rail.getByRole("button", { name: "Save version 2" })).toBeVisible();
    const box = async (name: string) =>
      (await page.getByRole("heading", { name: new RegExp(`^${name}`) }).boundingBox())!;
    const railBox = (await rail.boundingBox())!;
    const pageTitle = (await page.getByRole("heading", { level: 1 }).boundingBox())!;
    const title = (await page.getByLabel("Title", { exact: true }).boundingBox())!;
    const [sources, proof, location, details] = [
      await box("Sources"),
      await box("Proof"),
      await box("Location"),
      await box("Details"),
    ];
    // Header: the page title left, the actions top right, level with it.
    expect(railBox.x).toBeGreaterThan(title.x + title.width);
    expect(Math.abs(railBox.y - pageTitle.y)).toBeLessThan(12);
    // Main column: title, sources, proof. Side column: location, details, under the actions.
    expect(sources.y).toBeGreaterThan(title.y);
    expect(proof.y).toBeGreaterThan(sources.y);
    expect(location.x).toBeLessThanOrEqual(railBox.x + 1);
    expect(location.y).toBeGreaterThanOrEqual(railBox.y + railBox.height);
    expect(details.y).toBeGreaterThan(location.y);

    // Scrolled down, the title is gone and the actions stay top right.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(page.getByRole("heading", { level: 1 })).not.toBeInViewport();
    const pinned = (await rail.boundingBox())!;
    expect(pinned.y).toBeGreaterThanOrEqual(0);
    expect(Math.abs(pinned.x - railBox.x)).toBeLessThanOrEqual(1);
    await expect(rail.getByRole("button", { name: "Save version 2" })).toBeInViewport({ ratio: 1 });
  });

  test("publishes a request from the same form, counting its missing requirements", async ({ page }) => {
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
    await expect(rail.getByRole("button", { name: "Save request" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Save version/ })).toHaveCount(0);

    // The request names no conflict: Publish counts it, and its count names it.
    await expect(publish).toHaveAccessibleDescription(/^\d+ missing: .*Conflict/);
    const count = rail.getByRole("button", { name: /^\d+ missing: / });
    await count.hover();
    await expect(page.getByText(/^\d+ missing: .*Conflict$/).and(page.locator(":visible"))).toBeVisible();
    await expectNarrowViewportLayout(page, publish);
  });
});
