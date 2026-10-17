import { expect, test } from "@playwright/test";

import { ANALYST_ORGANIZATIONS, SIGNED_IN_USER } from "./support/fixtures";
import { mockApi } from "./support/mockApi";
import {
  expectControlInsideViewport,
  expectNarrowViewportLayout,
} from "./support/narrowLayout";

/**
 * An analyst's profile as a visitor reads it. The header carries a bio, the follower line and a
 * row of six organization logos, which has to wrap rather than push the column sideways.
 */
test.describe("profile", () => {
  test("wraps the organization logos on a narrow column", async ({ page }) => {
    await mockApi(page);
    await page.goto(`/profile/${SIGNED_IN_USER.username}`);

    const [managed, ...joined] = ANALYST_ORGANIZATIONS;
    const manager = page.getByRole("link", {
      name: `Org manager of ${managed.organization.name}`,
    });
    await expectNarrowViewportLayout(page, manager);
    await expect(manager).toHaveAttribute("href", `/organizations/${managed.organization.slug}`);
    for (const { organization } of joined) {
      await expectControlInsideViewport(
        page,
        page.getByRole("link", { name: `Member of ${organization.name}` }),
      );
    }

    await manager.hover();
    await expect(
      page.getByText(`Org manager of ${managed.organization.name}`, { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Organizations", { exact: true })).toHaveCount(0);
  });
});
