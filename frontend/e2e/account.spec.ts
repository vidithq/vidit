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
  test("gives each notification kind one email switch within the row", async ({ context, page }) => {
    await grantSession(context);
    await mockApi(page);
    await page.goto("/settings");

    const kinds = page.getByRole("switch", { name: "Request fulfilled" });
    await expect(kinds).toHaveCount(1);
    await expect(kinds).toHaveAttribute("aria-checked", "true");
    const viewportWidth = page.viewportSize()!.width;
    for (const name of ["Request fulfilled", "New follower", "Organization invite"]) {
      const row = page.getByRole("switch", { name });
      await row.scrollIntoViewIfNeeded();
      const box = (await row.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(36);
      expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth);
    }
    // The longest option, *People I follow*, keeps its whole label at 320px.
    const senders = page.getByRole("group", { name: "Accept approval requests from" });
    for (const option of await senders.getByRole("button").all()) {
      const fits = await option.evaluate((el) => el.scrollWidth <= el.clientWidth);
      expect(fits, `${await option.textContent()} is cut`).toBe(true);
    }
    await expectNoHorizontalOverflow(page);
  });
});
