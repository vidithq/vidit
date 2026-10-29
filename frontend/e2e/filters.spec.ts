import { expect, test, type Locator, type Page } from "@playwright/test";

import { LONG_TAG_NAME, REQUESTED_EVENT } from "./support/fixtures";
import { openFilterGroups } from "./support/filters";
import { grantSession, mockApi } from "./support/mockApi";
import {
  expectControlInsideViewport,
  expectNarrowViewportLayout,
  expectNoHorizontalOverflow,
  expectReadableFieldText,
} from "./support/narrowLayout";

/**
 * The filter panel on the three lists that carry it. From `lg` up the panel is a sticky right
 * rail beside the list, open under its Filters header; below `lg` it leaves the page, and a bar
 * of the Filters button and the active filters opens it in a sheet from the bottom edge. Its
 * groups start collapsed. A searched line lists its matches under its field, over the sheet, and
 * each pick applies at once.
 */
const PAGES = [
  { name: "feed", path: "/feed", signedIn: true },
  { name: "requests", path: "/requests", signedIn: false },
  { name: "search", path: "/search?q=rail", signedIn: false },
];

async function open(page: Page, path: string, signedIn: boolean) {
  if (signedIn) await grantSession(page.context());
  await mockApi(page);
  await page.goto(path);
}

/** Picks the long tag through the search field of the Tags line of `panel`, whose matches list
 *  on the body. */
async function pickLongTag(page: Page, panel: Locator) {
  const field = panel.getByRole("combobox", { name: "Tags" });
  await field.fill("counter");
  const option = page.getByRole("option", { name: LONG_TAG_NAME });
  await expect(option).toBeInViewport({ ratio: 1 });
  await option.click();
  await field.press("Escape");
  await expect(page.getByRole("listbox", { name: "Tags" })).toBeHidden();
  await expect(panel.getByRole("button", { name: `Remove ${LONG_TAG_NAME}` })).toBeVisible();
}

for (const target of PAGES) {
  test.describe(target.name, () => {
    test("opens the filters in a sheet from the Filters button", async ({ page }) => {
      await open(page, target.path, target.signedIn);

      const button = page.getByRole("button", { name: "Filters", exact: true });
      await expectNarrowViewportLayout(page, button);
      await expect(page.getByRole("complementary", { name: "Filters" })).toBeHidden();

      await button.click();
      const sheet = page.getByRole("dialog", { name: "Filters" });
      await expect(sheet).toBeVisible();
      await openFilterGroups(sheet, ["What", "When"]);
      await expect(sheet.getByRole("slider", { name: "Event date window start" })).toBeVisible();
      await expectReadableFieldText(page);
      await pickLongTag(page, sheet);
      await expectNoHorizontalOverflow(page);
      await expectControlInsideViewport(page, sheet.getByRole("button", { name: "Clear all" }));
      const done = sheet.getByRole("button", { name: "Done" });
      await expectControlInsideViewport(page, done);

      await done.click();
      await expect(sheet).toBeHidden();
      await expect(page.getByTitle(`Remove filter Tags: ${LONG_TAG_NAME}`)).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });

    test("keeps the panel in a sticky rail beside the list on a wide screen", async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await open(page, target.path, target.signedIn);

      const rail = page.getByRole("complementary", { name: "Filters" });
      await expect(rail.getByRole("heading", { name: "When" })).toBeVisible();
      await openFilterGroups(rail, ["What", "Source"]);
      await expect(rail.getByRole("combobox", { name: "Tags" })).toBeVisible();
      // The rail's header opens on a list; the phone bar's sheet button stands down.
      await expect(rail.getByRole("button", { name: "Filters", exact: true })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      await expect(page.locator('button[aria-haspopup="dialog"]', { hasText: "Filters" })).toBeHidden();
      await expect(rail).toHaveCSS("position", "sticky");

      const column = page.getByRole("link", { name: REQUESTED_EVENT.title });
      await expect(column).toBeVisible();
      const [railBox, columnBox] = [(await rail.boundingBox())!, (await column.boundingBox())!];
      expect(railBox.x, "the rail sits right of the list").toBeGreaterThanOrEqual(
        columnBox.x + columnBox.width,
      );

      // The matches float over the page: nothing in the rail moves when they open.
      const media = rail.getByRole("button", { name: "Media", exact: true });
      const before = (await media.boundingBox())!;
      await rail.getByRole("combobox", { name: "Tags" }).fill("counter");
      await expect(page.getByRole("listbox", { name: "Tags" })).toBeVisible();
      expect((await media.boundingBox())!.y).toBe(before.y);
      await expectNoHorizontalOverflow(page);
    });
  });
}

test("picks and removes a tag through its line, in the URL", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, "/search", false);

  const rail = page.getByRole("complementary", { name: "Filters" });
  await openFilterGroups(rail, ["What"]);
  await pickLongTag(page, rail);
  await expect(page).toHaveURL(/[?&]tag=/);

  await rail.getByRole("button", { name: `Remove ${LONG_TAG_NAME}` }).click();
  await expect(page).not.toHaveURL(/[?&]tag=/);
});
