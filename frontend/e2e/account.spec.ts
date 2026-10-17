import { expect, test } from "@playwright/test";

import { SIGNED_IN_USER } from "./support/fixtures";
import { grantSession, mockApi } from "./support/mockApi";
import {
  expectNarrowViewportLayout,
  expectNoHorizontalOverflow,
} from "./support/narrowLayout";

/**
 * Golden path 4: sign in, then settings.
 *
 * `/login` is public and runs with no cookie, which is what makes the form
 * render at all: `useRedirectIfAuthenticated` bounces a visitor who already
 * has one. `/settings` is behind the wall, so it gets the session cookie.
 */
test.describe("sign in", () => {
  test("signs in on a narrow column", async ({ page }) => {
    await mockApi(page);
    await page.goto("/login");

    const signIn = page.getByRole("button", { name: "Sign in" });
    await expectNarrowViewportLayout(page, signIn);

    await page.getByLabel("Email").fill(SIGNED_IN_USER.email);
    await page.getByLabel("Password").fill("correct-horse-battery");
    await signIn.click();

    // `next` defaults to `/map`, so a successful sign-in lands on the map.
    await expect(page).toHaveURL(/\/map$/);
  });
});

test.describe("settings", () => {
  test("reads on a narrow column", async ({ context, page }) => {
    await grantSession(context);
    await mockApi(page);
    await page.goto("/settings");

    await expect(page.getByText("@osint_hawk_2024")).toBeVisible();
    const updatePassword = page.getByRole("button", { name: "Update password" });
    await expectNarrowViewportLayout(page, updatePassword);
  });
  test("keeps each notification row's switches on the row", async ({ context, page }) => {
    await grantSession(context);
    await mockApi(page);
    await page.goto("/settings");

    const emailSwitches = page.getByRole("switch", { name: /, Email$/ });
    await expect(emailSwitches.first()).toBeVisible();
    // The fixture deployment sends no push, so the matrix holds the Email column only.
    await expect(page.getByRole("switch", { name: /, Push$/ })).toHaveCount(0);
    const viewportWidth = page.viewportSize()!.width;
    for (const email of await emailSwitches.all()) {
      await email.scrollIntoViewIfNeeded();
      const box = (await email.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(36);
      expect(box.height).toBeGreaterThanOrEqual(36);
      expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth);
    }
    await expect(
      page.getByText("This Vidit server does not send push notifications.", { exact: true }),
    ).toHaveCount(1);
    await expectNoHorizontalOverflow(page);
  });
});
