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

/** Hides the Web Share API, so Share opens its own menu whatever the runner's Chrome offers. */
async function withoutWebShare(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "share", { value: undefined, configurable: true });
  });
}

test.describe("shared event link", () => {
  test("holds the version, Share and More in the header on a narrow column", async ({ page }) => {
    await withoutWebShare(page);
    await mockApi(page);
    await page.goto(`/events/${EVENT_ID}`);

    await expect(page.getByRole("heading", { name: EVENT.title })).toBeVisible();

    // What a reader who followed a link acts on: passing the record on again.
    const share = page.getByRole("button", { name: "Share", exact: true });
    await expectNarrowViewportLayout(page, share);

    // A signed-out reader has no primary action, and the stamps left the header.
    await expect(page.getByRole("link", { name: /^Edit/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Approve\b/ })).toHaveCount(0);

    // The version selector names the version on screen and lists the versions plus the history.
    await page.getByRole("button", { name: "v1: choose a version" }).click();
    await expect(page.getByRole("menuitem")).toHaveText(["Version 1 Current", "Full history"]);
    await expectControlInsideViewport(page, page.getByRole("menuitem", { name: "Full history" }));
    await page.keyboard.press("Escape");

    await share.click();
    await expectControlInsideViewport(page, page.getByRole("menuitem", { name: "Share on X" }));
    await expectControlInsideViewport(page, page.getByRole("menuitem", { name: "Copy link" }));
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);

    await page.getByRole("button", { name: "More actions" }).click();
    await expect(page.getByRole("menuitem")).toHaveText(["Report"]);
    await expectNarrowViewportLayout(page, page.getByRole("menuitem", { name: "Report" }));
    await page.getByRole("menuitem", { name: "Report" }).click();
    await expectNarrowViewportLayout(page, page.getByRole("button", { name: "Send report" }));
  });

  test("stacks the Approvals card under the title, before the media", async ({ page }) => {
    await mockApi(page);
    await page.goto(`/events/${EVENT_ID}`);

    const card = page.getByRole("region", { name: "Approvals" });
    await expect(card.getByText(`Approved · ${EVENT_APPROVALS.length} · version 1`)).toBeVisible();
    const cardBox = await card.boundingBox();
    const mediaBox = await page.getByRole("heading", { name: "Source media" }).boundingBox();
    expect(cardBox!.y + cardBox!.height).toBeLessThanOrEqual(mediaBox!.y);

    // Five stamps, oldest first, then a bubble for the rest.
    const stamps = card.getByRole("list", { name: "Approved by" });
    await expect(stamps.getByRole("button", { name: /^Approved by/ })).toHaveCount(5);
    const first = stamps.getByRole("button", {
      name: `Approved by ${EVENT_APPROVALS[0].reviewer!.username}`,
    });
    expect((await first.boundingBox())?.width).toBe(28);
    await expectNarrowViewportLayout(page, stamps.getByRole("button", { name: "Show 2 more approvals" }));

    // The latest note, quoted with its author, wraps inside the card.
    await expect(card.locator("blockquote")).toHaveText(EVENT_APPROVALS[0].note!);

    // A tap opens the stamp's card, which holds the way to the profile.
    await first.click();
    await expectNarrowViewportLayout(page, page.getByRole("link", { name: "View profile" }));
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // The bubble expands the full list in place.
    await stamps.getByRole("button", { name: "Show 2 more approvals" }).click();
    await expect(card.getByRole("heading", { name: "Version 1, current" })).toBeVisible();
    await expectNarrowViewportLayout(page, card.getByRole("button", { name: "All approvals" }));
  });
});
