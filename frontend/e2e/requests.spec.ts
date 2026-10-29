import { expect, test } from "@playwright/test";

import { EVENT, EVENT_ID } from "./support/fixtures";
import { answerWith, mockApi } from "./support/mockApi";
import { expectNarrowViewportLayout } from "./support/narrowLayout";

/**
 * The request board, the narrowest content column in the product: a list
 * `<Item>` puts about 150px between its media slot and its badge at 320px.
 *
 * Public in `proxy.ts`, so this runs signed out.
 */
test.describe("requests", () => {
  test("reads on a narrow column", async ({ page }) => {
    await mockApi(page);
    await page.goto("/requests");

    const post = page.getByRole("link", { name: "Post request" });
    await expectNarrowViewportLayout(page, post);
  });

  // The page's action is in the title's action cluster, above the sort: under the title on a
  // phone, beside it on a wide screen.
  test("puts Post request in the title's actions, above the sort", async ({ page }) => {
    await mockApi(page);
    await page.goto("/requests");

    const link = page.getByRole("link", { name: "Post request" });
    const heading = page.getByRole("heading", { level: 1 });
    const sortGroup = page.getByRole("group", { name: "Sort requests" });
    const post = (await link.boundingBox())!;
    const sort = (await sortGroup.boundingBox())!;
    expect(post.y + post.height, "Post request sits above the sort").toBeLessThanOrEqual(sort.y);

    await page.setViewportSize({ width: 1280, height: 800 });
    const [wide, title] = [(await link.boundingBox())!, (await heading.boundingBox())!];
    expect(wide.x, "Post request sits right of the title").toBeGreaterThan(title.x + title.width);
    expect(Math.abs(wide.y + wide.height / 2 - (title.y + title.height / 2))).toBeLessThan(12);
  });

  // Geolocate shares the actions row with Share and Report, on one line at a phone's width.
  test("puts Geolocate on the request's actions row", async ({ page }) => {
    await mockApi(page);
    await answerWith(page, `/events/${EVENT_ID}`, {
      ...EVENT,
      status: "requested",
      geolocators: [],
    });
    await page.goto(`/requests/${EVENT_ID}`);

    const row = page.getByRole("group", { name: "Event actions" });
    const geolocate = row.getByRole("link", { name: "Geolocate" });
    await expect(geolocate).toBeVisible();
    const [share, located] = [
      (await row.getByRole("button", { name: "Share" }).boundingBox())!,
      (await geolocate.boundingBox())!,
    ];
    expect(
      Math.abs(share.y + share.height / 2 - (located.y + located.height / 2)),
      "Geolocate sits on Share's line",
    ).toBeLessThanOrEqual(2);
    await expectNarrowViewportLayout(page, geolocate);
  });
});
