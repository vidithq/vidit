import { expect, test } from "@playwright/test";

import { ORGANIZATION_SLUG } from "./support/fixtures";
import { grantSession, mockApi } from "./support/mockApi";
import { expectNarrowViewportLayout } from "./support/narrowLayout";

/**
 * The organization page as its org-admin reads it: the header, the member rows
 * with their role controls, and the invite picker. A long name, a long
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
    await expect(page.getByRole("button", { name: "Make org-admin" })).toBeVisible();
  });
});
