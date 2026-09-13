import { expect, test } from "@playwright/test";

import { COLLECTION, COLLECTION_ID } from "./support/fixtures";
import { grantSession, mockApi } from "./support/mockApi";
import { expectNarrowViewportLayout } from "./support/narrowLayout";

/**
 * A collection page, read by its owner.
 *
 * The owner rather than a visitor, because the owner is the narrow case: the
 * header carries a long title plus a three-control cluster, and every item row
 * carries a remove control beside its status badge. `/collections` is public in
 * `proxy.ts`, so the session cookie is granted for the owner controls rather
 * than for access.
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

  test("the header stays inside the column", async ({ context, page }) => {
    await grantSession(context);
    await mockApi(page);
    await page.goto(`/collections/${COLLECTION_ID}`);

    const heading = page.getByRole("heading", { name: COLLECTION.title });
    await expect(heading).toBeVisible();

    // The header holds the long title beside the owner's three-control
    // cluster, the row that wraps last on this page, so what is measured is
    // whether anything in it is laid out wider than the column it sits in.
    const overflow = await heading.evaluate((el) => {
      const frame = el.closest("header");
      if (!frame) throw new Error("the heading is not in the page header");
      return frame.scrollWidth - frame.clientWidth;
    });

    expect(overflow, "the header runs past the column").toBeLessThanOrEqual(1);
  });
});
