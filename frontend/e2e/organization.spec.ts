import { expect, test } from "@playwright/test";

import { ORGANIZATION_SLUG } from "./support/fixtures";
import { grantSession, mockApi } from "./support/mockApi";
import { expectNarrowViewportLayout } from "./support/narrowLayout";

/**
 * The organization page as its org manager reads it: the header, the member rows
 * with their role controls, the approvals in its name, its approval requests
 * with the audience control, and the invite picker. A long name, a long
 * username and a bio carrying a URL are the content that would push a phone
 * column sideways.
 */
test.describe("organization", () => {
  test("reads on a narrow column", async ({ context, page }) => {
    await grantSession(context);
    await mockApi(page);
    await page.goto(`/organizations/${ORGANIZATION_SLUG}`);

    const invite = page.getByRole("button", { name: "Invite" });
    await expectNarrowViewportLayout(page, invite);
    await expect(page.getByRole("button", { name: "Make org manager" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Decline" })).toBeVisible();
    await expect(page.getByRole("button", { name: "People our org managers follow" })).toBeVisible();
  });
});
