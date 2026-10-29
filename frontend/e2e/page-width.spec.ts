import { expect, test, type Page } from "@playwright/test";

import { EVENT_ID } from "./support/fixtures";
import { grantSession, mockApi } from "./support/mockApi";

/**
 * Every `PageShell` page shares one container: the title starts at one x on
 * every page, and from `lg` up a `max-w-6xl` column sits centred on the screen,
 * the nav rail counted in the left margin. A page without a rail keeps the 53rem reading width;
 * a page with a rail gives the main column the same width beside a 17.5rem
 * rail once the screen holds both.
 */
const READING_PX = 848;
const RAIL_PX = 280;

async function titleX(page: Page, path: string): Promise<number> {
  await page.goto(path);
  // The search page's field takes its title's place, and the title stays as a hidden heading.
  const title =
    path === "/search" ? page.getByRole("searchbox") : page.getByRole("heading", { level: 1 });
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

  test("centres the wide column on the screen", async ({ page }) => {
    for (const width of [1512, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/feed");
      const title = page.getByRole("heading", { level: 1 });
      await expect(title).toBeVisible();
      const { left, right, viewport } = await title.evaluate((el) => {
        const box = el.closest("header")!.parentElement!.getBoundingClientRect();
        return { left: box.left, right: box.right, viewport: document.documentElement.clientWidth };
      });
      expect(left, `left margin at ${width}px`).toBe(viewport - right);
    }
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

test.describe("rail top", () => {
  test.beforeEach(async ({ context, page }) => {
    await grantSession(context);
    await mockApi(page);
  });

  test("starts the About rail level with the first block of the column", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/about");
    const rail = page.getByRole("complementary", { name: "Links" });
    const first = page.getByRole("heading", { name: "Commitments" }).locator("xpath=ancestor::section");
    await expect(rail).toBeVisible();
    const title = page.getByRole("heading", { level: 1 });
    const railBox = (await rail.boundingBox())!;
    expect(railBox.y).toBe((await first.boundingBox())!.y);
    expect(railBox.y).toBeGreaterThan((await title.boundingBox())!.y);
  });
});

/** From `lg` up the back arrow and the right rail stick at their resting place. */
test.describe("sticky chrome", () => {
  test.beforeEach(async ({ context, page }) => {
    await page.setViewportSize({ width: 1512, height: 600 });
    await grantSession(context);
    await mockApi(page);
  });

  async function scrollBy(page: Page, y: number): Promise<void> {
    await page.evaluate((dy) => window.scrollBy(0, dy), y);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  }

  test("keeps the back arrow in the gutter", async ({ page }) => {
    await page.goto(`/events/${EVENT_ID}`);
    const back = page.getByRole("button", { name: "Back" });
    await expect(back).toBeVisible();
    const backAtRest = (await back.boundingBox())!;

    await scrollBy(page, 40);
    expect((await back.boundingBox())!.y).toBe(backAtRest.y);

    await scrollBy(page, 400);
    await expect(back).toBeInViewport();
    const backScrolled = (await back.boundingBox())!;
    expect(backScrolled.x).toBe(backAtRest.x);
    expect(backScrolled.y).toBe(backAtRest.y);
  });

  test("keeps a rail under the header in place", async ({ page }) => {
    await page.goto("/feed");
    const rail = page.getByRole("complementary", { name: "Filters" });
    await expect(rail).toBeVisible();
    await expect(rail).toHaveCSS("position", "sticky");
    const railAtRest = (await rail.boundingBox())!;

    await scrollBy(page, 40);
    expect((await rail.boundingBox())!.y).toBe(railAtRest.y);
  });
});
