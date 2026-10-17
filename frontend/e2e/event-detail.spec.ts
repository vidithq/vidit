import { expect, test, type Page } from "@playwright/test";

import { EVENT, EVENT_APPROVALS, EVENT_ID } from "./support/fixtures";
import { mockApi } from "./support/mockApi";
import { expectControlInsideViewport, expectNarrowViewportLayout } from "./support/narrowLayout";

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
    const cardBox = (await page.getByRole("region", { name: "Approvals" }).boundingBox())!;
    const shareBox = (await share.boundingBox())!;
    expect(shareBox.y).toBeGreaterThan(titleBox.y);
    expect(shareBox.y + shareBox.height).toBeLessThanOrEqual(cardBox.y);

    // A signed-out reader has no primary action, and the stamps stay in the Approvals card.
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

  test("stacks the Approvals card under the title, before the media", async ({ page }) => {
    await mockApi(page);
    await page.goto(`/events/${EVENT_ID}`);

    const card = page.getByRole("region", { name: "Approvals" });
    await expect(card.getByRole("list", { name: "Approved by" })).toBeVisible();
    const cardBox = await card.boundingBox();
    const mediaBox = await page.getByRole("heading", { name: "Source media" }).boundingBox();
    expect(cardBox!.y + cardBox!.height).toBeLessThanOrEqual(mediaBox!.y);

    // Two rows of stamps, oldest first, each a link to its signer's page, the bubble for the
    // rest taking the last slot.
    const stamps = card.getByRole("list", { name: "Approved by" });
    await expect(stamps.getByRole("link")).toHaveCount(13);
    const username = EVENT_APPROVALS[0].reviewer!.username;
    const first = stamps.getByRole("link", { name: username, exact: true });
    await expect(first).toHaveAttribute("href", `/profile/${username}`);
    expect((await first.boundingBox())?.width).toBe(28);
    await expectNarrowViewportLayout(page, stamps.getByRole("button", { name: "Show 3 more approvals" }));
    await expect(page.getByText(EVENT_APPROVALS[0].note!)).toHaveCount(0);

    // The bubble shows the rest of the stamps, which wrap inside the card.
    await stamps.getByRole("button", { name: "Show 3 more approvals" }).click();
    await expect(stamps.getByRole("link")).toHaveCount(EVENT_APPROVALS.length);
    await expectNarrowViewportLayout(page, stamps.getByRole("link").last());
  });

  test("puts the actions top right in the sticky rail, the title scrolling with the column", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1512, height: 900 });
    await mockApi(page);
    await page.goto(`/events/${EVENT_ID}`);

    const title = page.getByRole("heading", { level: 1 });
    const rail = page.getByRole("complementary", { name: "Actions and approvals" });
    const share = rail.getByRole("button", { name: "Share", exact: true });
    await expect(share).toBeVisible();
    await expect(rail).toHaveCSS("position", "sticky");

    const titleBox = (await title.boundingBox())!;
    const railBox = (await rail.boundingBox())!;
    expect(railBox.x).toBeGreaterThan(titleBox.x);
    expect(Math.abs(railBox.y - titleBox.y)).toBeLessThan(12);
    const reportBox = (await rail.getByRole("button", { name: "Report" }).boundingBox())!;
    expect(railBox.x + railBox.width - (reportBox.x + reportBox.width)).toBeLessThan(2);
    expect(reportBox.y).toBeLessThan(
      (await rail.getByRole("region", { name: "Approvals" }).boundingBox())!.y,
    );

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(title).not.toBeInViewport();
    await expect(share).toBeInViewport();
  });
});
