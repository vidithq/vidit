import { expect, test, type Locator, type Page } from "@playwright/test";

import { CONFLICTS, REQUESTED_EVENT, TAGS } from "./support/fixtures";
import { grantSession, mockApi } from "./support/mockApi";
import {
  expectControlInsideViewport,
  expectNarrowViewportLayout,
  expectNoHorizontalOverflow,
} from "./support/narrowLayout";

type Pick = (page: Page, panel: Locator) => Promise<void>;

const pickChip =
  (name: string): Pick =>
  (_page, panel) =>
    panel.getByRole("button", { name, exact: true }).click();

// The list renders in a portal on the body, outside the panel.
const pickConflict: Pick = async (page, panel) => {
  await panel.getByRole("combobox", { name: "Conflict" }).fill("russian");
  await page
    .getByRole("listbox", { name: "Conflict" })
    .getByRole("option", { name: new RegExp(`^${CONFLICTS[0].name}`) })
    .click();
  await expect(
    panel.getByRole("button", { name: new RegExp(`^Remove ${CONFLICTS[0].name}`) }),
  ).toBeVisible();
};

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
    pick: pickChip("Requests"),
    listed: REQUESTED_EVENT.title,
  },
  {
    name: "requests",
    path: "/requests",
    signedIn: false,
    section: "Conflict",
    pick: pickConflict,
    listed: REQUESTED_EVENT.title,
  },
  {
    name: "search",
    path: "/search?type=event",
    signedIn: false,
    section: "Conflict",
    pick: pickConflict,
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
      await target.pick(page, dialog);
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

test("picks and removes a tag through the search field, in the URL", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, "/search?type=event", false);

  const rail = page.getByRole("complementary", { name: "Filters" });
  await rail.getByRole("button", { name: "Toggle Tags" }).click();
  await rail.getByRole("combobox", { name: "Tags" }).fill("dro");
  const list = page.getByRole("listbox", { name: "Tags" });
  await expect(list.getByRole("option")).toHaveText([TAGS[0].name]);
  await list.getByRole("option", { name: TAGS[0].name }).click();
  await expect(page).toHaveURL(new RegExp(`[?&]tag=${TAGS[0].name}(&|$)`));

  await rail.getByRole("button", { name: `Remove ${TAGS[0].name}` }).click();
  await expect(page).not.toHaveURL(/[?&]tag=/);
});
