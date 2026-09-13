import { expect, test } from "@playwright/test";

import { COLLECTION, COLLECTION_ID } from "./support/fixtures";
import { grantSession, mockApi } from "./support/mockApi";
import {
  expectControlInsideViewport,
  expectNarrowViewportLayout,
  expectNoHorizontalOverflow,
} from "./support/narrowLayout";

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

    // Where the owner goes to put more of their work on it: their own
    // catalogue, since an event joins a collection from its own page.
    await expectNarrowViewportLayout(
      page,
      page.getByRole("link", { name: "Your geolocations" }),
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

/**
 * The same page read by a visitor, for the step player it opens the
 * collection's work with.
 *
 * A visitor rather than the owner, because the player is what every reader of
 * the page gets and the owner's controls are covered above. The player is the
 * one block on this page whose two halves are sized against each other: a map
 * beside a panel from `sm` up, stacked below it, so a phone is where the
 * column can be pushed open or a control can land off it.
 */
test.describe("collection player", () => {
  test("steps through the collection on a narrow column", async ({ page }) => {
    await mockApi(page);
    await page.goto(`/collections/${COLLECTION_ID}`);

    await expect(
      page.getByRole("heading", { name: COLLECTION.title }),
    ).toBeVisible();

    // The player opens on the first item, and the two moves are what a reader
    // came to this page to press.
    await expect(page.getByText("1 of 2")).toBeVisible();
    const next = page.getByRole("button", { name: "Next event" });
    await expectNarrowViewportLayout(page, next);
    await expectControlInsideViewport(
      page,
      page.getByRole("button", { name: "Previous event" }),
    );

    // The step is the share unit, so it rides the page's own URL.
    await next.click();
    await expect(page.getByText("2 of 2")).toBeVisible();
    await expect(page).toHaveURL(/\?step=2$/);
    await expectNoHorizontalOverflow(page);
  });
});
