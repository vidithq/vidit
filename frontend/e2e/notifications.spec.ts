import { expect, test } from "@playwright/test";

import { grantSession, mockApi } from "./support/mockApi";
import { expectNarrowViewportLayout } from "./support/narrowLayout";

/**
 * The notification feed with an open approval request, whose row carries Decline, and an
 * answered one. A long event title is the content a control beside the row would squeeze to a
 * few characters on a phone.
 */
test.describe("notifications", () => {
  test("keeps a request row's title at full width, with Decline below it", async ({
    context,
    page,
  }) => {
    await grantSession(context);
    await mockApi(page);
    await page.goto("/notifications");

    const rows = page.getByRole("link", { name: /asked you to approve/ });
    await expect(rows).toHaveCount(2);
    const decline = page.getByRole("button", { name: "Decline" });
    await expect(decline).toHaveCount(1);
    await expectNarrowViewportLayout(page, decline);

    const [openRow, answeredRow] = [(await rows.nth(0).boundingBox())!, (await rows.nth(1).boundingBox())!];
    const declineBox = (await decline.boundingBox())!;
    expect(declineBox.y).toBeGreaterThanOrEqual(openRow.y + openRow.height - 1);
    expect(Math.abs(openRow.width - answeredRow.width)).toBeLessThan(1);
    await expect(rows.nth(1)).toContainText("Declined");
  });
});
