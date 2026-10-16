import { expect, test, type Page } from "@playwright/test";

import { grantSession, mockApi } from "./support/mockApi";
import { expectNoHorizontalOverflow } from "./support/narrowLayout";

/**
 * `PageShell`'s `controls` slot: the view's segmented control sits under the
 * title, on the title's left edge, at the phone width and on a wide screen.
 */
const PAGES = [
  { name: "feed", path: "/feed", control: "Feed scope" },
  { name: "requests", path: "/requests", control: "Sort requests" },
  { name: "submit", path: "/submit", control: "Submission mode" },
];

async function expectUnderTitle(page: Page, control: string) {
  const group = page.getByRole("group", { name: control });
  await expect(group).toBeVisible();
  const title = page.getByRole("heading", { level: 1 });
  const [titleBox, groupBox] = [(await title.boundingBox())!, (await group.boundingBox())!];
  expect(groupBox.y, "the control sits under the title").toBeGreaterThanOrEqual(
    titleBox.y + titleBox.height,
  );
  expect(
    Math.abs(groupBox.x - titleBox.x),
    "the control starts on the title's edge",
  ).toBeLessThanOrEqual(1);
}

for (const target of PAGES) {
  test.describe(target.name, () => {
    test.beforeEach(async ({ context, page }) => {
      await grantSession(context);
      await mockApi(page);
    });

    test("puts the segmented control under the title", async ({ page }) => {
      await page.goto(target.path);
      await expectUnderTitle(page, target.control);
      await expectNoHorizontalOverflow(page);
    });

    test("keeps the control under the title on a wide screen", async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(target.path);
      await expectUnderTitle(page, target.control);
    });
  });
}
