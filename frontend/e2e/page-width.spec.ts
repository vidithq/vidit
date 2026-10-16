import { expect, test, type Page } from "@playwright/test";

import { EVENT_ID } from "./support/fixtures";
import { grantSession, mockApi } from "./support/mockApi";

/**
 * Every `PageShell` page shares one left-aligned container: the title starts
 * at one x on every page. A page without a rail keeps the 53rem reading width;
 * a page with a rail gives the main column the same width beside a 17.5rem
 * rail once the screen holds both.
 */
const READING_PX = 848;
const RAIL_PX = 280;

async function titleX(page: Page, path: string): Promise<number> {
  await page.goto(path);
  const title = page.getByRole("heading", { level: 1 });
  await expect(title).toBeVisible();
  return (await title.boundingBox())!.x;
}

test.describe("page width", () => {
  test.beforeEach(async ({ context, page }) => {
    await page.setViewportSize({ width: 1536, height: 900 });
    await grantSession(context);
    await mockApi(page);
  });

  test("starts every page's title at the same x", async ({ page }) => {
    const paths = ["/feed", "/requests", "/search", "/settings", `/events/${EVENT_ID}`];
    const xs = [];
    for (const path of paths) xs.push(await titleX(page, path));
    for (const x of xs) expect(x, `title x across ${paths.join(", ")}`).toBe(xs[0]);
  });

  test("keeps the reading width without a rail and beside one", async ({ page }) => {
    await page.goto("/settings");
    const title = page.getByRole("heading", { level: 1 });
    await expect(title).toBeVisible();
    const headerWidth = await title.evaluate(
      (el) => el.closest("header")!.getBoundingClientRect().width,
    );
    expect(headerWidth).toBe(READING_PX);

    await page.goto("/requests");
    const rail = page.getByRole("complementary", { name: "Filters" });
    await expect(rail).toBeVisible();
    const mainWidth = await rail.evaluate(
      (el) => el.nextElementSibling!.getBoundingClientRect().width,
    );
    expect((await rail.boundingBox())!.width).toBe(RAIL_PX);
    expect(mainWidth).toBe(READING_PX);
  });
});
