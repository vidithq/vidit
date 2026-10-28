import { expect, test } from "@playwright/test";

import { grantSession, mockApi } from "./support/mockApi";
import { expectNarrowViewportLayout } from "./support/narrowLayout";

/**
 * The notification feed with an open approval request and an answered one, both naming a long
 * event title. A row carries no action: it links to the event page, with the dismiss button and the arrow
 * inside the block at its right edge.
 */
test.describe("notifications", () => {
  test("wraps a long title, keeps the dismiss button and the arrow at the block's right edge", async ({
    context,
    page,
  }) => {
    await grantSession(context);
    await mockApi(page);
    await page.goto("/notifications");

    const rows = page.getByRole("link", { name: /asked you to approve/ });
    await expect(rows).toHaveCount(2);
    const dismiss = page.getByRole("button", { name: "Dismiss notification" });
    await expect(dismiss).toHaveCount(2);
    await expectNarrowViewportLayout(page, dismiss.first());
    await expect(page.getByRole("button", { name: /Accept|Decline|Approve/ })).toHaveCount(0);
    await expect(rows.nth(1)).toContainText("Declined");

    const block = rows.first().locator("xpath=..");
    const blockBox = (await block.boundingBox())!;
    const linkBox = (await rows.first().boundingBox())!;
    const dismissBox = (await dismiss.first().boundingBox())!;
    const arrowBox = (await block.locator("svg.lucide-arrow-right").boundingBox())!;

    expect(dismissBox.x).toBeGreaterThanOrEqual(linkBox.x + linkBox.width - 1);
    expect(arrowBox.x).toBeGreaterThanOrEqual(dismissBox.x + dismissBox.width - 1);
    expect(arrowBox.x + arrowBox.width).toBeLessThanOrEqual(blockBox.x + blockBox.width);
    expect(dismissBox.y).toBeGreaterThanOrEqual(blockBox.y);
    expect(dismissBox.y + dismissBox.height).toBeLessThanOrEqual(blockBox.y + blockBox.height);
    // The title wraps onto more than one line instead of being cut to a few characters.
    const title = rows.first().locator("p");
    const lineHeight = await title.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
    expect((await title.boundingBox())!.height).toBeGreaterThan(lineHeight * 1.5);

    // The dismiss button sits above the stretched link: a tap on it reaches the button, not the row.
    const hit = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.closest("button")?.getAttribute("aria-label"),
      { x: dismissBox.x + dismissBox.width / 2, y: dismissBox.y + dismissBox.height / 2 },
    );
    expect(hit).toBe("Dismiss notification");
  });
});
