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
    const viewportWidth = page.viewportSize()!.width;
    for (const email of await emailSwitches.all()) {
      const name = (await email.getAttribute("aria-label"))!;
      const push = page.getByRole("switch", { name: name.replace(/Email$/, "Push") });
      // The fixture deployment sends no push, so the column is disabled with one reason.
      await expect(push).toBeDisabled();
      await email.scrollIntoViewIfNeeded();
      const [emailBox, pushBox] = [(await email.boundingBox())!, (await push.boundingBox())!];
      for (const box of [emailBox, pushBox]) {
        expect(box.width).toBeGreaterThanOrEqual(36);
        expect(box.height).toBeGreaterThanOrEqual(36);
        expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth);
      }
      expect(Math.abs(emailBox.y - pushBox.y)).toBeLessThan(1);
      expect(pushBox.x).toBeGreaterThan(emailBox.x);
    }
    await expect(
      page.getByText("This Vidit server does not send push notifications.", { exact: true }),
    ).toHaveCount(1);
    await expectNoHorizontalOverflow(page);
  });
});
