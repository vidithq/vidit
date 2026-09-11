import { expect, test } from "@playwright/test";

import { SIGNED_IN_USER } from "./support/fixtures";
import { grantSession, mockApi } from "./support/mockApi";
import { expectNarrowViewportLayout } from "./support/narrowLayout";

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

    const updatePassword = page.getByRole("button", { name: "Update password" });
    await expectNarrowViewportLayout(page, updatePassword);
  });
});
