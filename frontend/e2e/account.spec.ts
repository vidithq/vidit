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

  // The pill is drawn over the row-wide switch button, so a click on it has to reach that button.
  // jsdom does no hit testing, so only a browser can tell.
  test("toggles a switch from a click on its pill", async ({ context, page }) => {
    await grantSession(context);
    await mockApi(page);
    await page.goto("/settings");

    const tooltips = page.getByRole("switch", { name: "Show help tooltips" });
    await expect(tooltips).toHaveAttribute("aria-checked", "true");
    const pill = tooltips.locator("xpath=..").locator("span[aria-hidden=true]").last();
    const box = (await pill.boundingBox())!;
    await page.mouse.click(box.x + box.width - 4, box.y + box.height / 2);

    await expect(tooltips).toHaveAttribute("aria-checked", "false");
  });

  test("flags every blank password field at once instead of a native bubble", async ({
    context,
    page,
  }) => {
    await grantSession(context);
    await mockApi(page);
    await page.goto("/settings");

    await page.getByLabel("New password", { exact: true }).fill("a-new-password");
    await page.getByRole("button", { name: "Update password" }).click();

    // No box on the page: the fields turn red, and a screen reader hears the list.
    await expect(page.getByRole("alert").filter({ hasText: "Fill in" })).toHaveCount(0);
    await expect(
      page.getByRole("status").filter({ hasText: "Fill in the required fields" }),
    ).toHaveText(
      "Fill in the required fields before continuing: Current password, Confirm new password.",
    );
    await expectNoHorizontalOverflow(page);
  });

  test("moves the accent colour with the arrow keys", async ({ context, page }) => {
    await grantSession(context);
    await mockApi(page);
    await page.goto("/settings");

    const swatches = page.getByRole("radiogroup", { name: "Accent color" }).getByRole("radio");
    const checked = swatches.and(page.locator("[aria-checked=true]"));
    const first = swatches.first();
    await first.focus();
    await page.keyboard.press("ArrowRight");

    await expect(swatches.nth(1)).toBeFocused();
    await expect(checked).toHaveCount(1);
    await expect(swatches.nth(1)).toHaveAttribute("aria-checked", "true");
    await expect(first).toHaveAttribute("aria-checked", "false");
  });
});
