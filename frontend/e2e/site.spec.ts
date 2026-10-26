import { expect, test } from "@playwright/test";

import { SITE, SITE_ID } from "./support/fixtures";
import { grantSession, mockApi } from "./support/mockApi";
import {
  expectControlInsideViewport,
  expectNarrowViewportLayout,
  expectNoHorizontalOverflow,
} from "./support/narrowLayout";

/**
 * A site's page and its three forms, read by the signed-in analyst who owns the site.
 *
 * The narrow cases: the header holds a long name; the pinned row holds the owner's five icons; an
 * image's source block holds a long title and a provider credit beside its file; a
 * linked event's card holds its effect and its author's controls; the Location and Details
 * blocks follow the main column, as on the event page; the contour editor
 * stacks a toolbar over a map; and the image editor holds the link list with its archive box.
 */
test.describe("site page", () => {
  test.beforeEach(async ({ context, page }) => {
    await grantSession(context);
    await mockApi(page);
  });

  test("lays the header, the sources and the linked events out inside the column", async ({ page }) => {
    await page.goto(`/sites/${SITE_ID}`);

    await expect(page.getByRole("heading", { level: 1, name: SITE.name })).toBeVisible();
    await expect(page.getByText("Sources (3)")).toBeVisible();
    const latest = page.getByRole("region", { name: "Image of 18 Jun 2026" });
    await expect(latest.getByText("On the map")).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // Below `lg` the side column follows the main column: Location, then Details.
    const location = page.getByRole("heading", { name: /^Location/ });
    const details = page.getByRole("heading", { name: /^Details/ });
    const linked = page.getByRole("heading", { name: /^Linked events \(1\)/ });
    const top = async (l: typeof location) => (await l.boundingBox())!.y;
    expect(await top(linked)).toBeLessThan(await top(location));
    expect(await top(location)).toBeLessThan(await top(details));
    await expectControlInsideViewport(page, page.getByRole("button", { name: "Copy coordinates" }));

    await page.getByRole("button", { name: "Next source" }).click();
    const older = page.getByRole("region", { name: "Image of 14 Nov 2025" });
    await older.getByRole("button", { name: "Show the zone of the image of 14 Nov 2025 on the map" }).click();
    await expect(older.getByText("On the map")).toBeVisible();
    await expect(page.getByText("Zone on")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectControlInsideViewport(page, page.getByRole("link", { name: "File an image" }));
    await expectControlInsideViewport(page, page.getByRole("button", { name: "Link one of my events" }));

    await expect(page.getByText("3.3 km outside the zone")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("keeps a linked event's controls inside the viewport and opens the effect change", async ({ page }) => {
    await page.goto(`/sites/${SITE_ID}`);

    const { title } = SITE.linked_events[0];
    await expectControlInsideViewport(page, page.getByRole("button", { name: `Unlink ${title}` }));
    await page.getByRole("button", { name: `Change the effect of ${title}` }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Change the effect" })).toBeVisible();
    await expectNarrowViewportLayout(page, dialog.getByRole("button", { name: "Save the effect" }));
    await expectControlInsideViewport(page, dialog.getByRole("button", { name: "Damage" }));
  });

  test("opens the link dialog inside the viewport", async ({ page }) => {
    await page.goto(`/sites/${SITE_ID}`);

    await page.getByRole("button", { name: "Link one of my events" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Link one of my events" })).toBeVisible();
    await expectNarrowViewportLayout(page, dialog.getByRole("button", { name: "Link", exact: true }));
    await expectControlInsideViewport(page, dialog.getByRole("button", { name: "Destruction" }));
  });

  test("lays the image form out inside the column", async ({ page }) => {
    await page.goto(`/sites/${SITE_ID}/images/new`);

    await expect(page.getByRole("heading", { level: 1, name: "File an image" })).toBeVisible();
    await expectNarrowViewportLayout(page, page.getByRole("button", { name: "File the image" }));
    await expectControlInsideViewport(page, page.getByRole("button", { name: "Add a link to image" }));
  });

  test("lays the contour editor out inside the column", async ({ page }) => {
    await page.goto(`/sites/${SITE_ID}/contour`);

    await expect(page.getByRole("heading", { level: 1, name: "Redraw the contour" })).toBeVisible();
    await expectNarrowViewportLayout(page, page.getByRole("button", { name: "Save the contour" }));
    await expectControlInsideViewport(page, page.getByRole("button", { name: "Back to the current contour" }));
  });

  test("lays the creation form out inside the column", async ({ page }) => {
    await page.goto("/sites/new");

    await expect(page.getByRole("heading", { level: 1, name: "New site" })).toBeVisible();
    await expectNarrowViewportLayout(page, page.getByRole("button", { name: "Create the site" }));
    await expectControlInsideViewport(page, page.getByRole("button", { name: "Start over" }));
  });
});
