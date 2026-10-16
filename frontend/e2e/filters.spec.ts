import { expect, test, type Page } from "@playwright/test";

import { CONFLICTS, REQUESTED_EVENT } from "./support/fixtures";
import { grantSession, mockApi } from "./support/mockApi";
import {
  expectControlInsideViewport,
  expectNarrowViewportLayout,
  expectNoHorizontalOverflow,
} from "./support/narrowLayout";

/**
 * The filter rail on the three lists that carry it. From `lg` up the panel is a
 * sticky right rail beside the list; below `lg` it leaves the page and a
 * "Filters (N)" button at the top of the list opens it full screen, with Apply
 * and Clear in reach.
 */
const PAGES = [
  {
    name: "feed",
    path: "/feed",
    signedIn: true,
    section: "Kind",
    chip: "Requests",
    listed: REQUESTED_EVENT.title,
  },
  {
    name: "requests",
    path: "/requests",
    signedIn: false,
    section: "Conflict",
    chip: CONFLICTS[0].name,
    listed: REQUESTED_EVENT.title,
  },
  {
    name: "search",
    path: "/search?type=event",
    signedIn: false,
    section: "Conflict",
    chip: CONFLICTS[0].name,
    listed: null,
  },
];

async function open(page: Page, path: string, signedIn: boolean) {
  if (signedIn) await grantSession(page.context());
  await mockApi(page);
  await page.goto(path);
}

for (const target of PAGES) {
  test.describe(target.name, () => {
    test("opens the filters full screen from the Filters button", async ({ page }) => {
      await open(page, target.path, target.signedIn);

      const button = page.getByRole("button", { name: "Filters", exact: true });
      await expectNarrowViewportLayout(page, button);
      await expect(page.getByRole("complementary", { name: "Filters" })).toBeHidden();

      await button.click();
      const dialog = page.getByRole("dialog", { name: "Filters" });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: `Toggle ${target.section}` }).click();
      await dialog.getByRole("button", { name: target.chip, exact: true }).click();
      await expectNoHorizontalOverflow(page);
      await expectControlInsideViewport(page, dialog.getByRole("button", { name: "Clear" }));
      const apply = dialog.getByRole("button", { name: "Apply" });
      await expectControlInsideViewport(page, apply);

      await apply.click();
      await expect(dialog).toBeHidden();
      await expect(page.getByRole("button", { name: "Filters (1)" })).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });

    test("keeps the panel in a sticky rail beside the list on a wide screen", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await open(page, target.path, target.signedIn);

      const rail = page.getByRole("complementary", { name: "Filters" });
      await expect(rail.getByRole("button", { name: `Toggle ${target.section}` })).toBeVisible();
      await expect(page.getByRole("button", { name: "Filters", exact: true })).toBeHidden();
      await expect(rail).toHaveCSS("position", "sticky");

      const column = target.listed
        ? page.getByRole("link", { name: target.listed })
        : page.getByRole("searchbox");
      await expect(column).toBeVisible();
      const [railBox, columnBox] = [(await rail.boundingBox())!, (await column.boundingBox())!];
      expect(railBox.x, "the rail sits right of the list").toBeGreaterThanOrEqual(
        columnBox.x + columnBox.width,
      );
      await expectNoHorizontalOverflow(page);
    });
  });
}
