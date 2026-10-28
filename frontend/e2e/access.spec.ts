import { expect, test } from "@playwright/test";

import { COLLECTION_ID, EVENT_ID, SIGNED_IN_USER, SITE_ID } from "./support/fixtures";
import { grantSession, mockApi } from "./support/mockApi";

/**
 * A signed-out visit to a protected page goes to sign-in with the page as `next`, whether the
 * proxy turns it away (`/feed`) or the page itself does (a write route under a public prefix),
 * and sign-in returns there.
 */
test.describe("protected pages", () => {
  for (const path of [
    "/feed",
    "/profile",
    "/collections/new",
    `/collections/${COLLECTION_ID}/edit`,
    "/sites/new",
    `/sites/${SITE_ID}/edit`,
    `/sites/${SITE_ID}/sources/new`,
    `/events/${EVENT_ID}/edit`,
  ]) {
    test(`sends a signed-out visit to ${path} to sign-in with next`, async ({ page }) => {
      await mockApi(page);
      await page.goto(path);
      await expect(page).toHaveURL(`/login?next=${encodeURIComponent(path)}`);
    });
  }

  test("returns to the page after sign-in", async ({ page }) => {
    await mockApi(page);
    await page.goto("/collections/new");
    await expect(page).toHaveURL("/login?next=%2Fcollections%2Fnew");

    await page.getByLabel("Email").fill(SIGNED_IN_USER.email);
    await page.getByLabel("Password").fill("correct-horse-battery");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL("/collections/new");
    await expect(page.getByLabel("Title", { exact: true })).toBeVisible();
  });

  test("says the session ended when its cookies are gone", async ({ context, page }) => {
    await grantSession(context);
    await mockApi(page);
    await page.goto("/settings");
    await expect(page.getByRole("button", { name: "Update password" })).toBeVisible();

    await context.clearCookies();
    await page.goto("/feed");

    await expect(page).toHaveURL("/login?next=%2Ffeed");
    await expect(page.getByRole("alert").filter({ hasText: "Your session ended." })).toBeVisible();
  });
});
