import { expect, test } from "@playwright/test";

import { COLLECTION, COLLECTION_ID } from "./support/fixtures";
import { grantSession, mockApi } from "./support/mockApi";
import { expectNarrowViewportLayout } from "./support/narrowLayout";

/**
 * A collection page, read by its owner.
 *
 * The owner rather than a visitor, because the owner is the narrow case: the
 * header carries the cover band over a long title plus a three-control
 * cluster, and every item row carries a remove control beside its status
 * badge. `/collections` is public in `proxy.ts`, so the session cookie is
 * granted for the owner controls rather than for access.
 */
test.describe("collection page", () => {
  test("reads on a narrow column", async ({ context, page }) => {
    await grantSession(context);
    await mockApi(page);
    await page.goto(`/collections/${COLLECTION_ID}`);

    await expect(
      page.getByRole("heading", { name: COLLECTION.title }),
    ).toBeVisible();

    // What the owner came to do on this page: put more of their work on it.
    await expectNarrowViewportLayout(
      page,
      page.getByRole("link", { name: "Add events" }),
    );
  });

  test("the cover band stays inside the column", async ({ context, page }) => {
    await grantSession(context);
    await mockApi(page);
    await page.goto(`/collections/${COLLECTION_ID}`);

    const band = page.locator("header img").first();
    await expect(band).toBeVisible();

    // A full-width image in the page header is the one element sized by its
    // own content rather than by the column, so it is measured against the
    // frame it sits in.
    const measured = await band.evaluate((el) => {
      const frame = el.closest("header");
      if (!frame) throw new Error("the band is not in the page header");
      return (
        el.getBoundingClientRect().right - frame.getBoundingClientRect().right
      );
    });

    expect(measured, "the cover band runs past the column").toBeLessThanOrEqual(
      0,
    );
  });
});
