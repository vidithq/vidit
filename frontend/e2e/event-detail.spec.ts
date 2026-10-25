import { expect, test, type Page } from "@playwright/test";

import {
  ANALYST_PROFILE,
  EVENT,
  EVENT_APPROVALS,
  EVENT_ID,
  EVENT_WITH_SOURCES,
} from "./support/fixtures";
import { answerWith, grantSession, mockApi } from "./support/mockApi";
import {
  expectControlInsideViewport,
  expectNarrowViewportLayout,
  expectNoHorizontalOverflow,
} from "./support/narrowLayout";
import { swipeLeft } from "./support/touch";

/**
 * Golden path 1: someone opens a shared event link and reads the record.
 *
 * Signed out, which is how a shared link arrives: `/events` is public in
 * `proxy.ts`, so no session cookie is granted here.
 */

/** Hides the Web Share API, so Share copies the link whatever the runner's Chrome offers. */
async function withoutWebShare(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "share", { value: undefined, configurable: true });
  });
}

test.describe("shared event link", () => {
  test("holds the version, Share and Report under the title on a narrow column", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await withoutWebShare(page);
    await mockApi(page);
    await page.goto(`/events/${EVENT_ID}`);

    await expect(page.getByRole("heading", { name: EVENT.title })).toBeVisible();

    // What a reader who followed a link acts on: passing the record on again.
    const share = page.getByRole("button", { name: "Share", exact: true });
    await expectNarrowViewportLayout(page, share);
    const titleBox = (await page.getByRole("heading", { level: 1 }).boundingBox())!;
    const approvalsBox = (await page.getByRole("region", { name: "Approvals" }).boundingBox())!;
    const shareBox = (await share.boundingBox())!;
    expect(shareBox.y).toBeGreaterThan(titleBox.y);
    expect(shareBox.y + shareBox.height).toBeLessThanOrEqual(approvalsBox.y);

    // A signed-out reader has no primary action, and the stamps stay under the actions row.
    await expect(page.getByRole("link", { name: /^Edit/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Approve\b/ })).toHaveCount(0);

    // The version selector names the version on screen and lists the versions plus the history.
    await page.getByRole("button", { name: "v1: choose a version" }).click();
    const items = page.getByRole("menuitem");
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toHaveAccessibleName("v1");
    await expect(items.nth(0)).toHaveAttribute("aria-current", "page");
    await expect(items.nth(1)).toHaveAccessibleName("History");
    await expectControlInsideViewport(page, page.getByRole("menuitem", { name: "History" }));
    await page.keyboard.press("Escape");

    // One click copies the link: no menu, the confirmation only for screen readers.
    await share.click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: "Link copied" })).toHaveCount(1);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      `${new URL(page.url()).origin}/events/${EVENT_ID}`,
    );

    // No menu: a reader's report flag sits beside Share.
    await expect(page.getByRole("button", { name: "More actions" })).toHaveCount(0);
    const report = page.getByRole("button", { name: "Report" });
    await expectNarrowViewportLayout(page, report);
    await report.click();
    await expectNarrowViewportLayout(page, page.getByRole("button", { name: "Send report" }));
  });

  test("stacks the approvals under the actions, before the sources", async ({ page }) => {
    await mockApi(page);
    await page.goto(`/events/${EVENT_ID}`);

    const approvals = page.getByRole("region", { name: "Approvals" });
    await expect(approvals.getByRole("list", { name: "Approved by" })).toBeVisible();
    const approvalsBox = await approvals.boundingBox();
    const mediaBox = await page.getByRole("heading", { name: "Sources" }).boundingBox();
    expect(approvalsBox!.y + approvalsBox!.height).toBeLessThanOrEqual(mediaBox!.y);

    // Every stamp, oldest first, each a link to its signer's page; no bubble and no count.
    const stamps = approvals.getByRole("list", { name: "Approved by" });
    await expect(stamps.getByRole("link")).toHaveCount(EVENT_APPROVALS.length);
    await expect(stamps.getByRole("button")).toHaveCount(0);
    await expect(approvals).not.toContainText(/\d/);
    const username = EVENT_APPROVALS[0].reviewer!.username;
    const first = stamps.getByRole("link", { name: new RegExp(`^${username} approved v`) });
    await expect(first).toHaveAttribute("href", `/profile/${username}`);
    expect((await first.boundingBox())?.width).toBe(28);
    // The stamps wrap inside the side column.
    await expectNarrowViewportLayout(page, stamps.getByRole("link").last());
  });

  test("puts the actions top right of the side column, the location level with the sources", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1512, height: 900 });
    await mockApi(page);
    await page.goto(`/events/${EVENT_ID}`);

    const title = page.getByRole("heading", { level: 1 });
    const row = page.getByRole("group", { name: "Event actions" });
    await expect(row.getByRole("button", { name: "Share", exact: true })).toBeVisible();

    const titleBox = (await title.boundingBox())!;
    const rowBox = (await row.boundingBox())!;
    expect(rowBox.x).toBeGreaterThan(titleBox.x + titleBox.width / 2);
    expect(Math.abs(rowBox.y - titleBox.y)).toBeLessThan(12);
    const sources = (await page.getByRole("heading", { name: /^Sources/ }).boundingBox())!;
    const details = (await page.getByRole("heading", { name: "Details" }).boundingBox())!;
    const location = (await page.getByRole("heading", { name: "Location" }).boundingBox())!;
    expect(location.x).toBeGreaterThan(rowBox.x - 1);
    expect(Math.abs(location.y - sources.y)).toBeLessThan(2);
    expect(details.x).toBe(location.x);
    expect(details.y).toBeGreaterThan(location.y);
    const reportBox = (await row.getByRole("button", { name: "Report" }).boundingBox())!;
    expect(reportBox.y).toBeLessThan(
      (await page.getByRole("region", { name: "Approvals" }).boundingBox())!.y,
    );
  });
});

test.describe("event page on a phone", () => {
  test("reads in one column: title, actions and approvals, sources, proof, location, details", async ({
    page,
  }) => {
    await mockApi(page);
    await page.goto(`/events/${EVENT_ID}`);

    const approvals = page.getByRole("region", { name: "Approvals" });
    await expect(approvals.getByRole("list", { name: "Approved by" })).toBeVisible();
    const blocks = [
      page.getByRole("heading", { level: 1 }),
      page.getByRole("group", { name: "Event actions" }),
      approvals,
      page.getByRole("heading", { name: /^Sources/ }),
      page.getByRole("heading", { name: "Proof" }),
      page.getByRole("heading", { name: "Location" }),
      page.getByRole("heading", { name: "Details" }),
    ];
    const boxes = [];
    for (const block of blocks) boxes.push((await block.boundingBox())!);
    for (let i = 1; i < boxes.length; i++) {
      expect(boxes[i].y, `block ${i + 1} starts under block ${i}`).toBeGreaterThanOrEqual(
        boxes[i - 1].y + boxes[i - 1].height - 0.5,
      );
    }
    // One column: the side column's blocks start on the title's left edge, not beside it.
    const left = boxes[0].x;
    for (const box of [boxes[2], ...boxes.slice(3)]) {
      expect(Math.abs(box.x - left)).toBeLessThanOrEqual(1);
    }
    await expectNoHorizontalOverflow(page);
  });

  test("stacks a lone source's file above its rows, across the column", async ({ page }) => {
    await mockApi(page);
    await page.goto(`/events/${EVENT_ID}`);

    const card = page.getByRole("region", { name: "Source 1", exact: true });
    const file = card.locator("img").first();
    await expect(file).toBeVisible();
    const title = (await page.getByRole("heading", { level: 1 }).boundingBox())!;
    const cardBox = (await card.boundingBox())!;
    const fileBox = (await file.boundingBox())!;
    const firstRow = (await card.getByText("Title", { exact: true }).boundingBox())!;
    expect(Math.abs(cardBox.x - title.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(cardBox.width - title.width)).toBeLessThanOrEqual(1);
    expect(fileBox.y + fileBox.height).toBeLessThanOrEqual(firstRow.y);
    // The file takes the card's width, less the lead's padding, rather than a column beside the rows.
    expect(fileBox.width).toBeGreaterThan(cardBox.width * 0.8);
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("sources row on a touch screen", () => {
  test.use({ hasTouch: true });

  test("shows one card and a peek of the next, and moves by a swipe or the arrows", async ({
    page,
  }) => {
    await mockApi(page);
    await answerWith(page, `/events/${EVENT_ID}`, EVENT_WITH_SOURCES);
    await page.goto(`/events/${EVENT_ID}`);

    const row = page.getByRole("region", { name: "Sources", exact: true });
    const first = page.getByRole("region", { name: "Source 1", exact: true });
    const second = page.getByRole("region", { name: "Source 2", exact: true });
    await expect(page.getByText("1 of 4", { exact: true })).toBeVisible();
    const rowBox = (await row.boundingBox())!;
    const firstBox = (await first.boundingBox())!;
    const secondBox = (await second.boundingBox())!;
    const rowRight = rowBox.x + rowBox.width;
    expect(firstBox.width).toBeGreaterThan(rowBox.width * 0.8);
    expect(secondBox.x, "the next card peeks").toBeLessThan(rowRight);
    expect(secondBox.x + secondBox.width).toBeGreaterThan(rowRight);
    await expectNoHorizontalOverflow(page);

    // A swipe left scrolls the row by one card, which snaps to the row's edge.
    await swipeLeft(
      page,
      Math.round(rowBox.x + rowBox.width * 0.8),
      Math.round(firstBox.y + 40),
      Math.round(firstBox.width * 0.6),
    );
    await expect(page.getByText("2 of 4", { exact: true })).toBeVisible();
    await expect
      .poll(async () => Math.abs((await second.boundingBox())!.x - rowBox.x))
      .toBeLessThanOrEqual(1);

    // The arrows answer a tap and hold the 36px tap floor.
    const next = page.getByRole("button", { name: "Next source" });
    const previous = page.getByRole("button", { name: "Previous source" });
    for (const arrow of [next, previous]) {
      const box = (await arrow.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(36);
      expect(box.height).toBeGreaterThanOrEqual(36);
    }
    await next.tap();
    await expect(page.getByText("3 of 4", { exact: true })).toBeVisible();
    await previous.tap();
    await expect(page.getByText("2 of 4", { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("approval stamps on a touch screen", () => {
  test.use({ hasTouch: true });

  test("shows a stamp's label on the first tap and gives a site admin's delete a 36px target", async ({
    context,
    page,
  }) => {
    await grantSession(context);
    await mockApi(page);
    await answerWith(page, "/admin/me", { is_admin: true });
    const username = EVENT_APPROVALS[0].reviewer!.username;
    // The profile the second tap opens.
    await answerWith(page, `/users/${username}`, { ...ANALYST_PROFILE, username });
    await page.goto(`/events/${EVENT_ID}`);

    const stamps = page.getByRole("list", { name: "Approved by" });
    const first = stamps.getByRole("link", { name: new RegExp(`^${username} approved v`) });
    const neighbour = stamps.getByRole("link").nth(1);
    const remove = stamps.getByRole("button", { name: `Delete approval by ${username}` });
    await expect(remove).toBeVisible();

    // What sits under a point: the delete control, a stamp's link, or neither.
    const hit = (x: number, y: number) =>
      page.evaluate(
        ([px, py]) =>
          document
            .elementFromPoint(px, py)
            ?.closest("a, button")
            ?.getAttribute("aria-label") ?? null,
        [x, y],
      );
    const disc = (await remove.boundingBox())!;
    expect(disc.width).toBe(20);
    // The target is a 36px square up and right of the 20px disc, from 6px into it.
    const label = `Delete approval by ${username}`;
    expect(await hit(disc.x + 7, disc.y - 15)).toBe(label);
    expect(await hit(disc.x + 41, disc.y - 15)).toBe(label);
    expect(await hit(disc.x + 41, disc.y + 19)).toBe(label);
    expect(await hit(disc.x + 7, disc.y + 19)).toBe(label);
    // The pictures stay their links: this one's centre and its neighbour's.
    const firstBox = (await first.boundingBox())!;
    const neighbourBox = (await neighbour.boundingBox())!;
    expect(await hit(firstBox.x + 10, firstBox.y + firstBox.height / 2)).toBe(
      await first.getAttribute("aria-label"),
    );
    expect(
      await hit(neighbourBox.x + neighbourBox.width / 2, neighbourBox.y + neighbourBox.height / 2),
    ).toBe(await neighbour.getAttribute("aria-label"));
    await expectNoHorizontalOverflow(page);

    // The first tap shows who approved which version when; the second follows the link.
    await first.tap();
    await expect(page.getByText(new RegExp(`^${username} approved v1 on `))).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(`/events/${EVENT_ID}`);
    await first.tap();
    await expect(page).toHaveURL(new RegExp(`/profile/${username}$`));
  });
});

